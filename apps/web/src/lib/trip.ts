import type { BookingStatus, PaymentMethod, RideOption } from './booking';
import type { FareBreakdown } from './fare';
import type { LatLng, Place } from './geo';

// A ride request as a driver sees it before accepting: where and what, never who.
export interface NearbyRequest {
  id: string;
  pickup: Place;
  destination: Place;
  seats: number;
  rideOption: RideOption;
  paymentMethod: PaymentMethod;
  directKm: string;
  estimatedFare: string;
  requestedAt: string;
  // Straight-line km from the driver's Tesla, or from where its route goes on.
  pickupDistanceKm: string;
  // How much longer the route gets with this request in it; null for an idle Tesla.
  addedKm: string | null;
}

export type NextAction = 'arrive' | 'start' | 'complete';

// One passenger in the driver's Tesla.
export interface TripBooking {
  id: string;
  passenger: { name: string };
  status: Extract<BookingStatus, 'ACCEPTED' | 'DRIVER_ARRIVED' | 'STARTED'>;
  pickup: Place;
  destination: Place;
  seats: number;
  rideOption: RideOption;
  paymentMethod: PaymentMethod;
  directKm: string;
  estimatedFare: string;
  acceptedAt: string;
  arrivedAt: string | null;
  startedAt: string | null;
  nextAction: NextAction;
  // The next action happens at the next stop, so it can be taken now.
  canAct: boolean;
  // From then on, a passenger who hasn't come can be marked a no-show; null before arrival.
  noShowFrom: string | null;
  canNoShow: boolean;
  // Cancelling after then records a penalty against the driver.
  penaltyFrom: string;
  cancelRecordsPenalty: boolean;
}

// One stop on the driver's route, in order.
export interface TripStop {
  id: string;
  bookingId: string;
  passenger: { name: string };
  type: 'pickup' | 'dropoff';
  place: Place;
  sequence: number;
  plannedOdometerKm: string;
  // The reading, once the stop is reached.
  actualOdometerKm: string | null;
  reachedAt: string | null;
  isNext: boolean;
}

// Who the ride options still let into the Tesla: no one on a solo ride, one gender on a
// same-gender trip.
export type JoinRule = 'anyone' | 'no_one' | 'women' | 'men';

// The body of GET /driver/pool and every trip action, with the Tesla's seats as they stand.
export interface DriverTrip {
  id: string;
  createdAt: string;
  seats: { capacity: number; taken: number };
  joinRule: JoinRule;
  // Km along the trip where the route goes on from.
  odometerKm: string;
  stops: TripStop[];
  bookings: TripBooking[];
}

// Where the Tesla is on the driver's map: the point its route goes on from, as the API plans
// it (driver-map LLD §2). `stop` is the stop it is at; null at its saved location.
export interface TeslaSpot {
  point: LatLng;
  stop: TripStop | null;
}

// The pickup the driver has arrived at, else the last stop reached, else the saved location,
// which is where the trip began. Stops come in route order.
export function teslaSpot(saved: LatLng | null, trip: DriverTrip | null): TeslaSpot | null {
  const stops = trip?.stops ?? [];
  const next = stops.find((stop) => stop.actualOdometerKm === null);
  const waitingAt =
    next?.type === 'pickup' &&
    trip?.bookings.some((b) => b.id === next.bookingId && b.status === 'DRIVER_ARRIVED')
      ? next
      : undefined;
  const at = waitingAt ?? stops.filter((stop) => stop.actualOdometerKm !== null).at(-1);
  if (at) return { point: at.place, stop: at };
  return saved ? { point: saved, stop: null } : null;
}

// "At Rafiq's pickup · Banani Road 11"
export function describeSpot(stop: TripStop): string {
  const kind = stop.type === 'pickup' ? 'pickup' : 'drop-off';
  return `At ${stop.passenger.name}'s ${kind} · ${stop.place.label}`;
}

export interface CompletedTrip {
  pool: DriverTrip | null;
  fare: FareBreakdown;
}
