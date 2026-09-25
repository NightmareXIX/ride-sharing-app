import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { fares, type Fare } from '../db/schema/index.js';
import { FARE_RATES, type RideOption } from '../domain/fare.js';
import type { DistanceMethod } from '../geo/distance.js';

// A completed ride's fare with every figure needed to check it by hand (FR-F6, FR-P11).
export interface FareBreakdown {
  pickupOdometerKm: string;
  dropoffOdometerKm: string;
  actualKm: string;
  sharedKm: string;
  directKm: string;
  distanceMethod: DistanceMethod;
  baseFare: string;
  perKmRate: string;
  sharedKmDiscount: string;
  seats: number;
  seatMultiplier: string;
  rideOption: RideOption;
  optionMultiplier: string;
  estimatedFare: string;
  computedFare: string;
  finalFare: string;
}

export const fareColumns = {
  pickupOdometerKm: fares.pickupOdometerKm,
  dropoffOdometerKm: fares.dropoffOdometerKm,
  actualKm: fares.actualKm,
  sharedKm: fares.sharedKm,
  directKm: fares.directKm,
  distanceMethod: fares.distanceMethod,
  seats: fares.seats,
  seatMultiplier: fares.seatMultiplier,
  rideOption: fares.rideOption,
  optionMultiplier: fares.optionMultiplier,
  estimatedFare: fares.estimatedFare,
  computedFare: fares.computedFare,
  finalFare: fares.finalFare,
};

export type FareRow = Pick<Fare, keyof typeof fareColumns>;

export function toFareBreakdown(row: FareRow): FareBreakdown {
  return { ...row, ...FARE_RATES };
}

export async function getFare(db: Database, bookingId: string): Promise<FareBreakdown | null> {
  const [row] = await db.select(fareColumns).from(fares).where(eq(fares.bookingId, bookingId));
  return row ? toFareBreakdown(row) : null;
}
