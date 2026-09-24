import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { vehicles, type Vehicle } from '../db/schema/index.js';
import type { LatLng } from '../geo/serviceArea.js';
import { AppError } from '../http/errors.js';

// What a driver sees about their own Tesla.
export interface DriverVehicle {
  id: string;
  name: string;
  capacity: number;
  isOnline: boolean;
  location: LatLng | null;
}

const vehicleColumns = {
  id: vehicles.id,
  name: vehicles.name,
  capacity: vehicles.capacity,
  isOnline: vehicles.isOnline,
  currentLat: vehicles.currentLat,
  currentLng: vehicles.currentLng,
};

type VehicleRow = Pick<
  Vehicle,
  'id' | 'name' | 'capacity' | 'isOnline' | 'currentLat' | 'currentLng'
>;

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

// Only a Tesla with a location can go online, since nearby requests are found from it.
// Going online twice is harmless (NFR-37).
export async function goOnline(db: Database, driverId: string): Promise<DriverVehicle> {
  const [row] = await db
    .update(vehicles)
    .set({ isOnline: true, updatedAt: sql`now()` })
    .where(and(byDriver(driverId), isNotNull(vehicles.currentLat)))
    .returning(vehicleColumns);
  if (row) return toDriverVehicle(row);

  // No row changed: either there is no Tesla, or it has no location yet.
  await getDriverVehicle(db, driverId);
  throw new AppError(422, 'LOCATION_REQUIRED', 'Set your location on the map before going online.');
}

// Phase 3 adds the rule that a driver with passengers can't go offline (FR-D3).
export async function goOffline(db: Database, driverId: string): Promise<DriverVehicle> {
  const [row] = await db
    .update(vehicles)
    .set({ isOnline: false, updatedAt: sql`now()` })
    .where(byDriver(driverId))
    .returning(vehicleColumns);
  if (!row) throw noVehicle();
  return toDriverVehicle(row);
}

// Set by hand on the map; there is no live GPS (FR-D4).
export async function setLocation(
  db: Database,
  driverId: string,
  location: LatLng,
): Promise<DriverVehicle> {
  const [row] = await db
    .update(vehicles)
    .set({ currentLat: location.lat, currentLng: location.lng, updatedAt: sql`now()` })
    .where(byDriver(driverId))
    .returning(vehicleColumns);
  if (!row) throw noVehicle();
  return toDriverVehicle(row);
}
