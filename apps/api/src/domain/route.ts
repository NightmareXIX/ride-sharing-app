import Big from 'big.js';
import type { DistanceMethod, LegLookup } from '../geo/distance.js';
import type { LatLng } from '../geo/serviceArea.js';

// A trip's route and its odometer (FR-L5), kept free of I/O so it is easy to test
// (NFR-26). Km are strings with 3 decimal places, added exactly with big.js.

export type StopType = 'pickup' | 'dropoff';

// A stop still to be planned: whose, which kind and where.
export interface RouteStopPlace {
  bookingId: string;
  type: StopType;
  point: LatLng;
}

// A stop with its planned km along the trip, and how the leg into it was measured.
export interface PlannedStop extends RouteStopPlace {
  plannedKm: string;
  method: DistanceMethod;
}

// A stop as the trip holds it: `reachedKm` is its reading once the driver got there.
export interface TripStop extends PlannedStop {
  reachedKm: string | null;
}

// Where the rest of the route is planned from, and the km there.
export interface Anchor {
  point: LatLng;
  km: string;
}

function toKm(amount: Big): string {
  return amount.toFixed(3);
}

// Each stop's km is the previous one's plus the road distance between them.
export function planStops(
  anchor: Anchor,
  stops: readonly RouteStopPlace[],
  leg: LegLookup,
): PlannedStop[] {
  let at = anchor.point;
  let km = new Big(anchor.km);
  return stops.map((stop) => {
    const road = leg(at, stop.point);
    km = km.plus(road.km);
    at = stop.point;
    return { ...stop, plannedKm: toKm(km), method: road.method };
  });
}

// The trip so far, seen from the driver's next move.
export interface RouteProgress {
  anchor: Anchor;
  // The pickup of a passenger the driver is waiting for. It stays the next stop, and
  // nothing is planned before it.
  pinned: TripStop | null;
  // Unreached stops after the anchor, in order. Only these can be re-planned.
  pending: TripStop[];
  // The unreached stop with the lowest sequence.
  next: TripStop | null;
}

// Reached stops always come first, since the driver follows the order. The anchor is the
// pickup the driver is waiting at, else the last stop reached, else where the trip began.
export function routeProgress(
  stops: readonly TripStop[],
  origin: LatLng,
  isArrived: (bookingId: string) => boolean,
): RouteProgress {
  const reached = stops.filter((stop) => stop.reachedKm !== null);
  const unreached = stops.filter((stop) => stop.reachedKm === null);
  const next = unreached[0] ?? null;

  if (next && next.type === 'pickup' && isArrived(next.bookingId)) {
    return {
      anchor: { point: next.point, km: next.plannedKm },
      pinned: next,
      pending: unreached.slice(1),
      next,
    };
  }
  const last = reached.at(-1);
  return {
    anchor: last
      ? { point: last.point, km: last.reachedKm ?? last.plannedKm }
      : { point: origin, km: '0.000' },
    pinned: null,
    pending: unreached,
    next,
  };
}

// Km along the trip while a passenger is aboard: from their pickup to their drop-off.
export interface Aboard {
  from: string;
  to: string;
}

// The km of `own` during which at least one other booking is aboard (FR-F4). Overlapping
// co-passengers count once, and a passenger's own extra seats don't count (FR-F1).
export function sharedKm(own: Aboard, others: readonly Aboard[]): string {
  const start = new Big(own.from);
  const end = new Big(own.to);
  const clipped = others
    .map((other) => {
      const from = new Big(other.from);
      const to = new Big(other.to);
      return { from: from.gt(start) ? from : start, to: to.lt(end) ? to : end };
    })
    .filter((span) => span.to.gt(span.from))
    .sort((a, b) => a.from.cmp(b.from));

  let shared = new Big(0);
  let coveredTo = start;
  for (const span of clipped) {
    const from = span.from.gt(coveredTo) ? span.from : coveredTo;
    if (span.to.gt(from)) {
      shared = shared.plus(span.to.minus(from));
      coveredTo = span.to;
    }
  }
  return toKm(shared);
}
