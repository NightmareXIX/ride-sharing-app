import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { driverPenalties, vehicles, type Vehicle } from '../db/schema/index.js';
import type { LatLng } from '../geo/serviceArea.js';
import { AppError } from '../http/errors.js';
import { activePoolId } from './pools.js';

// What a driver sees about their own Tesla.
export interface DriverVehicle {
  id: string;
  name: string;
  capacity: number;
  // Seats held by the passengers aboard or on their way (FR-R2).
  occupiedSeats: number;
  isOnline: boolean;
  location: LatLng | null;
  // Late cancels recorded against the driver (FR-D13). What they lead to isn't decided yet.
  penaltyCount: number;
}

// The driver's penalty records, counted wherever the Tesla is returned.
const penaltyCount = sql<number>`(
  SELECT count(*) FROM ${driverPenalties} WHERE ${driverPenalties.driverId} = ${vehicles.driverId}
)`.mapWith(Number);

const vehicleColumns = {
  id: vehicles.id,
  name: vehicles.name,
  capacity: vehicles.capacity,
  occupiedSeats: vehicles.occupiedSeats,
  isOnline: vehicles.isOnline,
  currentLat: vehicles.currentLat,
  currentLng: vehicles.currentLng,
  penaltyCount,
};

type VehicleRow = Pick<
  Vehicle,
  'id' | 'name' | 'capacity' | 'occupiedSeats' | 'isOnline' | 'currentLat' | 'currentLng'
> & { penaltyCount: number };

function toDriverVehicle({ currentLat, currentLng, ...rest }: VehicleRow): DriverVehicle {
  return {
    ...rest,
    location:
      currentLat !== null && currentLng !== null ? { lat: currentLat, lng: currentLng } : null,
  };
}

function noVehicle(): AppError {
  return new AppError(404, 'NOT_FOUND', "You haven't registered a Tesla.");
}

function byDriver(driverId: string) {
  return eq(vehicles.driverId, driverId);
}

export async function getDriverVehicle(db: Database, driverId: string): Promise<DriverVehicle> {
  const [row] = await db.select(vehicleColumns).from(vehicles).where(byDriver(driverId));
  if (!row) throw noVehicle();
  return toDriverVehicle(row);
}

// Every change to a Tesla bumps its version, so an accept checked against the Tesla as it
// was is noticed (FR-C3).
const touched = { version: sql`${vehicles.version} + 1`, updatedAt: sql`now()` };

// Only a Tesla with a location can go online, since nearby requests are found from it.
// Going online twice is harmless (NFR-37).
export async function goOnline(db: Database, driverId: string): Promise<DriverVehicle> {
  const [row] = await db
    .update(vehicles)
    .set({ isOnline: true, ...touched })
    .where(and(byDriver(driverId), isNotNull(vehicles.currentLat)))
    .returning(vehicleColumns);
  if (row) return toDriverVehicle(row);

  // No row changed: either there is no Tesla, or it has no location yet.
  await getDriverVehicle(db, driverId);
  throw new AppError(422, 'LOCATION_REQUIRED', 'Set your location on the map before going online.');
}

// Changes a Tesla that has no passenger. The row is locked first, so an accept already
// running finishes before the check, and its trip is seen (FR-D3).
async function updateIdleVehicle(
  db: Database,
  driverId: string,
  set: Partial<Pick<Vehicle, 'isOnline' | 'currentLat' | 'currentLng'>>,
  refusal: string,
): Promise<DriverVehicle> {
  return db.transaction(async (tx) => {
    const [tesla] = await tx
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(byDriver(driverId))
      .for('update');
    if (!tesla) throw noVehicle();
    if (await activePoolId(tx, tesla.id)) {
      throw new AppError(409, 'HAS_ACTIVE_BOOKINGS', refusal);
    }

    const [row] = await tx
      .update(vehicles)
      .set({ ...set, ...touched })
      .where(eq(vehicles.id, tesla.id))
      .returning(vehicleColumns);
    if (!row) throw new Error(`Vehicle ${tesla.id} vanished while locked`);
    return toDriverVehicle(row);
  });
}

// Not while a passenger is in the Tesla (FR-D3). Going offline twice is harmless.
export function goOffline(db: Database, driverId: string): Promise<DriverVehicle> {
  return updateIdleVehicle(
    db,
    driverId,
    { isOnline: false },
    'Finish or cancel your current ride before going offline.',
  );
}

// Set by hand on the map; there is no live GPS (FR-D4). Not during a ride.
export function setLocation(
  db: Database,
  driverId: string,
  location: LatLng,
): Promise<DriverVehicle> {
  return updateIdleVehicle(
    db,
    driverId,
    { currentLat: location.lat, currentLng: location.lng },
    'Finish or cancel your current ride before moving your Tesla.',
  );
}
