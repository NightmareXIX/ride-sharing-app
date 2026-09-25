import Big from 'big.js';
import type { LegLookup } from '../geo/distance.js';
import type { LatLng } from '../geo/serviceArea.js';
import { FARE_RATES } from './fare.js';
import {
  planStops,
  sharedKm,
  type Aboard,
  type Anchor,
  type PlannedStop,
  type RouteStopPlace,
} from './route.js';

// The matching rule (FR-L3): whether a request can join a trip, and where its stops go.
// Pure, so it is easy to test and explain (NFR-26). Seats (e) are claimed by the accept's
// conditional update; solo and same-gender (f) arrive in phase 7.

// Any detour adds at most this much to a passenger's ride (FR §2, FR-L3(c)).
export const MAX_DETOUR_KM = '1.000';

// computed ≤ estimate reduces to detour ≤ (8 / 20) × sharedKm (FR-L3(d)).
const SHARED_KM_RATIO = new Big(FARE_RATES.sharedKmDiscount).div(FARE_RATES.perKmRate);

// A booking already in the trip. `pickupKm` is fixed once it is reached, or while the
// driver waits there; `dropoffKm` once the passenger is dropped off.
export interface TripBooking {
  id: string;
  directKm: string;
  pickupKm: string | null;
  dropoffKm: string | null;
}

export interface TripRoute {
  anchor: Anchor;
  // Unreached stops after the anchor, in order.
  pending: readonly RouteStopPlace[];
  // Every booking with a stop in the trip, including those already dropped off.
  bookings: readonly TripBooking[];
}

export interface MatchCandidate {
  bookingId: string;
  pickup: LatLng;
  destination: LatLng;
  directKm: string;
}

export type NoMatchReason = 'PICKUP_NOT_ON_ROUTE' | 'DETOUR_TOO_LONG' | 'FARE_ABOVE_ESTIMATE';

export type MatchResult =
  // The pending stops as re-planned with the new booking's, and how much longer the route got.
  { ok: true; stops: PlannedStop[]; addedKm: string } | { ok: false; reason: NoMatchReason };

const maxDetour = new Big(MAX_DETOUR_KM);

// Km the route grows by when `point` is visited between `from` and `to`.
function detourVia(leg: LegLookup, from: LatLng, point: LatLng, to: LatLng): Big {
  return new Big(leg(from, point).km).plus(leg(point, to).km).minus(leg(from, to).km);
}

function endKm(anchor: Anchor, stops: readonly PlannedStop[]): Big {
  return new Big(stops.at(-1)?.plannedKm ?? anchor.km);
}

// Each passenger's km aboard under a plan: fixed readings first, else the planned stops.
function aboardUnder(bookings: readonly TripBooking[], stops: readonly PlannedStop[]) {
  const planned = new Map(stops.map((stop) => [`${stop.bookingId}:${stop.type}`, stop.plannedKm]));
  const aboard = new Map<string, Aboard>();
  for (const booking of bookings) {
    const from = booking.pickupKm ?? planned.get(`${booking.id}:pickup`);
    const to = booking.dropoffKm ?? planned.get(`${booking.id}:dropoff`);
    if (from !== undefined && to !== undefined) aboard.set(booking.id, { from, to });
  }
  return aboard;
}

function rideKm(span: Aboard): Big {
  return new Big(span.to).minus(span.from);
}

// Tries every place for the new pickup and drop-off among the pending stops, keeps the
// valid ones (FR-L3 (a)–(d)), and returns the one that makes the route shortest. On a
// tie, existing stops stay earlier: the latest pickup place, then the latest drop-off.
export function bestInsertion(
  route: TripRoute,
  candidate: MatchCandidate,
  leg: LegLookup,
): MatchResult {
  const { anchor, pending } = route;
  const before = planStops(anchor, pending, leg);
  const beforeAboard = aboardUnder(route.bookings, before);
  const beforeEnd = endKm(anchor, before);
  const everyone: TripBooking[] = [
    ...route.bookings,
    { id: candidate.bookingId, directKm: candidate.directKm, pickupKm: null, dropoffKm: null },
  ];
  const pickupStop: RouteStopPlace = {
    bookingId: candidate.bookingId,
    type: 'pickup',
    point: candidate.pickup,
  };
  const dropoffStop: RouteStopPlace = {
    bookingId: candidate.bookingId,
    type: 'dropoff',
    point: candidate.destination,
  };

  let best: { stops: PlannedStop[]; added: Big } | null = null;
  let pickupOnRoute = false;
  let fareOnlyFailure = false;

  for (let i = 0; i < pending.length; i += 1) {
    // (a) The pickup lies ahead on the route: on the leg into pending stop i, within the
    // detour allowance. A pickup past the route's end would branch off it.
    const legStart = i === 0 ? anchor.point : (pending[i - 1] as RouteStopPlace).point;
    const legEnd = (pending[i] as RouteStopPlace).point;
    if (detourVia(leg, legStart, candidate.pickup, legEnd).gt(maxDetour)) continue;
    pickupOnRoute = true;

    for (let j = i; j <= pending.length; j += 1) {
      // (b) The destination lies on the route after the pickup, within the allowance: on
      // the leg into pending stop j. Past the end (j = n), the route extends instead, and
      // the newcomer's own detour limit below keeps it from branching.
      const next = pending[j];
      if (next) {
        const from = j === i ? candidate.pickup : (pending[j - 1] as RouteStopPlace).point;
        if (detourVia(leg, from, candidate.destination, next.point).gt(maxDetour)) continue;
      }

      const order = [
        ...pending.slice(0, i),
        pickupStop,
        ...pending.slice(i, j),
        dropoffStop,
        ...pending.slice(j),
      ];
      const stops = planStops(anchor, order, leg);
      const verdict = judge(everyone, candidate.bookingId, beforeAboard, stops);
      if (verdict === 'FARE_ABOVE_ESTIMATE') fareOnlyFailure = true;
      if (verdict !== 'ok') continue;

      const added = endKm(anchor, stops).minus(beforeEnd);
      if (!best || added.lte(best.added)) best = { stops, added };
    }
  }

  if (best) return { ok: true, stops: best.stops, addedKm: best.added.toFixed(3) };
  if (!pickupOnRoute) return { ok: false, reason: 'PICKUP_NOT_ON_ROUTE' };
  return { ok: false, reason: fareOnlyFailure ? 'FARE_ABOVE_ESTIMATE' : 'DETOUR_TOO_LONG' };
}

// (b)–(d) for one plan. Only passengers whose ride gets longer, and the newcomer, are
// checked, so earlier rounding can't block a later match.
function judge(
  everyone: readonly TripBooking[],
  newcomer: string,
  beforeAboard: ReadonlyMap<string, Aboard>,
  stops: readonly PlannedStop[],
): 'ok' | 'DETOUR_TOO_LONG' | 'FARE_ABOVE_ESTIMATE' {
  const aboard = aboardUnder(everyone, stops);
  let verdict: 'ok' | 'FARE_ABOVE_ESTIMATE' = 'ok';
  for (const booking of everyone) {
    const span = aboard.get(booking.id);
    if (!span) continue;
    const previous = beforeAboard.get(booking.id);
    const affected = booking.id === newcomer || !previous || rideKm(span).gt(rideKm(previous));
    if (!affected) continue;

    const detour = rideKm(span).minus(booking.directKm);
    // (b), (c): small detours only. For the newcomer this stops the route branching.
    if (detour.gt(maxDetour)) return 'DETOUR_TOO_LONG';
    // (d): nobody's fare may rise above their estimate.
    const others = [...aboard].filter(([id]) => id !== booking.id).map(([, other]) => other);
    const shared = sharedKm(span, others);
    if (detour.gt(SHARED_KM_RATIO.times(shared))) verdict = 'FARE_ABOVE_ESTIMATE';
  }
  return verdict;
}
