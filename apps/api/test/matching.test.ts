import { describe, expect, it } from 'vitest';
import { finalFare } from '../src/domain/fare.js';
import { bestInsertion, type TripRoute } from '../src/domain/matching.js';
import { sharedKm } from '../src/domain/route.js';
import type { LegLookup } from '../src/geo/distance.js';
import { fallbackRoadKm } from '../src/geo/haversine.js';
import type { LatLng } from '../src/geo/serviceArea.js';

// Legs from a table of km between named points, the same both ways.
function tableLegs(points: Record<string, LatLng>, km: Record<string, string>): LegLookup {
  const name = (point: LatLng) =>
    Object.keys(points).find((key) => points[key]?.lat === point.lat) ?? '?';
  return (from, to) => {
    const a = name(from);
    const b = name(to);
    if (a === b) return { km: '0.000', method: 'routed' };
    const found = km[`${a}${b}`] ?? km[`${b}${a}`];
    if (!found) throw new Error(`No km for ${a}${b}`);
    return { km: found, method: 'routed' };
  };
}

// The fallback an evaluator gets without a map key (phase 5 LLD §7).
const fallbackLegs: LegLookup = (from, to) =>
  from.lat === to.lat && from.lng === to.lng
    ? { km: '0.000', method: 'routed' }
    : { km: fallbackRoadKm(from, to), method: 'fallback' };

const BANANI = { lat: 23.7937, lng: 90.4066 };
const MOHAKHALI = { lat: 23.7812, lng: 90.409 };
const GULSHAN_1 = { lat: 23.7806, lng: 90.4163 };
const UTTARA = { lat: 23.871, lng: 90.398 };
const MIRPUR = { lat: 23.8069, lng: 90.3687 };

// Jashim has accepted Nusrat; nobody is picked up yet.
function nusratAccepted(): TripRoute {
  return {
    anchor: { point: BANANI, km: '0.000' },
    pending: [
      { bookingId: 'nusrat', type: 'pickup', point: BANANI },
      { bookingId: 'nusrat', type: 'dropoff', point: MOHAKHALI },
    ],
    bookings: [{ id: 'nusrat', directKm: '1.835', pickupKm: null, dropoffKm: null }],
  };
}

describe("Nusrat and Rafiq's trip (FR-L4)", () => {
  const rafiq = {
    bookingId: 'rafiq',
    pickup: BANANI,
    destination: GULSHAN_1,
    directKm: '2.287',
  };

  it('uses the distances the LLD works by hand', () => {
    expect(fallbackRoadKm(BANANI, MOHAKHALI)).toBe('1.835');
    expect(fallbackRoadKm(BANANI, GULSHAN_1)).toBe('2.287');
    expect(fallbackRoadKm(MOHAKHALI, GULSHAN_1)).toBe('0.970');
  });

  it('pools them: Nusrat is dropped first, and the route grows by 0.970 km', () => {
    const match = bestInsertion(nusratAccepted(), rafiq, fallbackLegs);

    if (!match.ok) throw new Error(match.reason);
    expect(match.addedKm).toBe('0.970');
    expect(match.stops.map((s) => `${s.bookingId} ${s.type} ${s.plannedKm}`)).toEqual([
      'nusrat pickup 0.000',
      'rafiq pickup 0.000',
      'nusrat dropoff 1.835',
      'rafiq dropoff 2.805',
    ]);
  });

  it('prices both rides as the LLD does', () => {
    const nusrat = { from: '0.000', to: '1.835' };
    const rafiqAboard = { from: '0.000', to: '2.805' };

    const nusratFare = finalFare(
      { directKm: '1.835', actualKm: '1.835', sharedKm: sharedKm(nusrat, [rafiqAboard]) },
      1,
      'pool',
    );
    const rafiqFare = finalFare(
      { directKm: '2.287', actualKm: '2.805', sharedKm: sharedKm(rafiqAboard, [nusrat]) },
      1,
      'pool',
    );

    expect([nusratFare.sharedKm, nusratFare.estimatedFare, nusratFare.finalFare]).toEqual([
      '1.835',
      '66.70',
      '52.02',
    ]);
    expect([rafiqFare.sharedKm, rafiqFare.estimatedFare, rafiqFare.finalFare]).toEqual([
      '1.835',
      '75.74',
      '71.42',
    ]);
  });

  it('turns Rafiq away with the old Mohakhali pin: Gulshan 1 branches off', () => {
    // Dropping Rafiq first stretches Nusrat's ride by 1.56 km; dropping him second, his own
    // by 1.516 km. Both are over the 1 km allowance.
    const oldMohakhali = { lat: 23.7781, lng: 90.405 };
    const route = nusratAccepted();
    route.pending = [
      { bookingId: 'nusrat', type: 'pickup', point: BANANI },
      { bookingId: 'nusrat', type: 'dropoff', point: oldMohakhali },
    ];
    route.bookings = [{ id: 'nusrat', directKm: '2.265', pickupKm: null, dropoffKm: null }];

    expect(bestInsertion(route, rafiq, fallbackLegs)).toEqual({
      ok: false,
      reason: 'DETOUR_TOO_LONG',
    });
  });

  it('refuses a pickup that is nowhere near the route', () => {
    const faraway = { bookingId: 'x', pickup: UTTARA, destination: MIRPUR, directKm: '9.000' };

    expect(bestInsertion(nusratAccepted(), faraway, fallbackLegs)).toEqual({
      ok: false,
      reason: 'PICKUP_NOT_ON_ROUTE',
    });
  });
});

describe('the matching rule (FR-L3)', () => {
  // A straight road S → P → Q → D, and a side street to X.
  const points = {
    S: { lat: 23.8, lng: 90.4 },
    P: { lat: 23.801, lng: 90.4 },
    Q: { lat: 23.802, lng: 90.4 },
    D: { lat: 23.803, lng: 90.4 },
    X: { lat: 23.804, lng: 90.4 },
  };
  const { S, P, Q, D, X } = points;
  const leg = tableLegs(points, {
    SP: '1.000',
    SQ: '2.000',
    SD: '5.000',
    SX: '2.500',
    PQ: '3.000',
    PD: '5.000',
    PX: '1.500',
    QD: '2.500',
    QX: '1.500',
    DX: '4.000',
  });

  // Passenger A rides P → D, direct 5 km, and is aboard.
  const aboard: TripRoute = {
    anchor: { point: P, km: '1.000' },
    pending: [{ bookingId: 'a', type: 'dropoff', point: D }],
    bookings: [{ id: 'a', directKm: '5.000', pickupKm: '1.000', dropoffKm: null }],
  };

  it("gives FR §8's pooled example: rides 5.5 km, shares 3 km, pays 116.00", () => {
    const match = bestInsertion(
      aboard,
      { bookingId: 'b', pickup: P, destination: Q, directKm: '3.000' },
      leg,
    );
    if (!match.ok) throw new Error(match.reason);

    const [, bDrop, aDrop] = match.stops;
    expect(bDrop?.bookingId).toBe('b');
    const aRide = { from: '1.000', to: aDrop?.plannedKm ?? '' };
    const bRide = { from: '1.000', to: bDrop?.plannedKm ?? '' };
    const trip = {
      directKm: '5.000',
      actualKm: '5.500',
      sharedKm: sharedKm(aRide, [bRide]),
    };

    expect(aDrop?.plannedKm).toBe('6.500');
    expect(trip.sharedKm).toBe('3.000');
    expect(finalFare(trip, 1, 'pool').finalFare).toBe('116.00');
    expect(finalFare(trip, 2, 'pool').finalFare).toBe('174.00');
    expect(finalFare(trip, 2, 'same_gender').finalFare).toBe('182.70');
  });

  it('refuses a detour of more than 1 km for a passenger aboard', () => {
    // X is 0.6 km off A's road and Q 0.9 km off the next leg: each fits on its own, but
    // together A would ride 1 + 1 + 4.5 = 6.5 km instead of 5.
    const viaX = bestInsertion(
      aboard,
      { bookingId: 'b', pickup: X, destination: Q, directKm: '1.000' },
      tableLegs(points, { PX: '1.000', XD: '4.600', PD: '5.000', XQ: '1.000', QD: '4.500' }),
    );

    expect(viaX).toEqual({ ok: false, reason: 'DETOUR_TOO_LONG' });
  });

  it('refuses a detour worth more than the pool discount', () => {
    // B shares only 0.1 km with A, but makes A's ride 0.6 km longer: 0.6 > 0.4 × 0.1.
    const small = tableLegs(points, {
      PX: '0.500',
      XQ: '0.100',
      PQ: '0.500',
      QD: '5.000',
      PD: '5.000',
      XD: '5.000',
    });
    const match = bestInsertion(
      aboard,
      { bookingId: 'b', pickup: X, destination: Q, directKm: '0.100' },
      small,
    );

    expect(match).toEqual({ ok: false, reason: 'FARE_ABOVE_ESTIMATE' });
  });

  it('lets the route extend past its end, but not branch', () => {
    // X is 1.5 km off A's road, and 3.5 km past D: B would ride 8.5 km for a 3 km trip.
    const sideways = tableLegs(points, { PD: '5.000', PX: '3.000', DX: '3.500' });
    const branch = bestInsertion(
      aboard,
      { bookingId: 'b', pickup: P, destination: X, directKm: '3.000' },
      sideways,
    );
    expect(branch).toEqual({ ok: false, reason: 'DETOUR_TOO_LONG' });

    // X is a little past D: B rides 5.8 against a direct 5.5, and shares 5 km.
    const straight = tableLegs(points, { PD: '5.000', PX: '5.500', DX: '0.800' });
    const extend = bestInsertion(
      aboard,
      { bookingId: 'b', pickup: P, destination: X, directKm: '5.500' },
      straight,
    );
    if (!extend.ok) throw new Error(extend.reason);
    expect(extend.stops.map((s) => `${s.bookingId} ${s.type}`)).toEqual([
      'b pickup',
      'a dropoff',
      'b dropoff',
    ]);
    expect(extend.addedKm).toBe('0.800');
  });

  it('never plans a stop before the pickup the driver waits at', () => {
    // The anchor is W's pickup at P; only the stops after it can move.
    const waiting: TripRoute = {
      anchor: { point: P, km: '1.000' },
      pending: [{ bookingId: 'w', type: 'dropoff', point: D }],
      bookings: [{ id: 'w', directKm: '5.000', pickupKm: '1.000', dropoffKm: null }],
    };
    const match = bestInsertion(
      waiting,
      { bookingId: 'b', pickup: S, destination: Q, directKm: '2.000' },
      tableLegs(points, { SP: '1.000', SD: '6.000', PD: '5.000', SQ: '2.000', QD: '2.500' }),
    );

    // S lies behind the Tesla: going back for it is a 2 km detour.
    expect(match).toEqual({ ok: false, reason: 'PICKUP_NOT_ON_ROUTE' });
  });

  it('keeps existing stops first when two places cost the same', () => {
    const match = bestInsertion(
      {
        anchor: { point: S, km: '0.000' },
        pending: [
          { bookingId: 'a', type: 'pickup', point: P },
          { bookingId: 'a', type: 'dropoff', point: D },
        ],
        bookings: [{ id: 'a', directKm: '5.000', pickupKm: null, dropoffKm: null }],
      },
      { bookingId: 'b', pickup: P, destination: D, directKm: '5.000' },
      leg,
    );
    if (!match.ok) throw new Error(match.reason);

    expect(match.stops.map((s) => `${s.bookingId} ${s.type}`)).toEqual([
      'a pickup',
      'b pickup',
      'a dropoff',
      'b dropoff',
    ]);
    expect(match.addedKm).toBe('0.000');
  });

  it("doesn't check a passenger whose ride doesn't change", () => {
    // A was measured at 5 km, but its legs now add up to 5.9: that alone blocks nothing.
    const drifted: TripRoute = {
      ...aboard,
      bookings: [{ id: 'a', directKm: '4.000', pickupKm: '1.000', dropoffKm: null }],
    };
    const match = bestInsertion(
      drifted,
      { bookingId: 'b', pickup: D, destination: X, directKm: '4.000' },
      leg,
    );

    expect(match.ok).toBe(true);
  });
});
