import { describe, expect, it } from 'vitest';
import {
  planStops,
  routeProgress,
  sharedKm,
  type RouteStopPlace,
  type TripStop,
} from '../src/domain/route.js';
import type { LegLookup } from '../src/geo/distance.js';

const A = { lat: 23.8, lng: 90.4 };
const B = { lat: 23.81, lng: 90.4 };
const C = { lat: 23.82, lng: 90.4 };

// Km between the made-up points: along one road, A → B → C.
const ROAD: Record<string, string> = { '23.8>23.81': '1.250', '23.81>23.82': '0.755' };
const leg: LegLookup = (from, to) => {
  if (from.lat === to.lat) return { km: '0.000', method: 'routed' };
  const km = ROAD[`${from.lat}>${to.lat}`];
  if (!km) throw new Error('unknown leg');
  return { km, method: 'routed' };
};

function stop(bookingId: string, type: 'pickup' | 'dropoff', point = A): RouteStopPlace {
  return { bookingId, type, point };
}

function tripStop(place: RouteStopPlace, plannedKm: string, reached: boolean): TripStop {
  return { ...place, plannedKm, method: 'routed', reachedKm: reached ? plannedKm : null };
}

describe('planned odometer (FR-L5)', () => {
  it('adds each leg to the km before it, exactly', () => {
    const planned = planStops(
      { point: A, km: '2.000' },
      [stop('n', 'pickup', A), stop('n', 'dropoff', B), stop('r', 'dropoff', C)],
      leg,
    );

    expect(planned.map((s) => s.plannedKm)).toEqual(['2.000', '3.250', '4.005']);
  });

  it('plans nothing for an empty route', () => {
    expect(planStops({ point: A, km: '0.000' }, [], leg)).toEqual([]);
  });
});

describe('where the route is planned from', () => {
  const pickup = stop('n', 'pickup', B);
  const dropoff = stop('n', 'dropoff', C);
  const origin = A;

  it('starts where the trip began, at 0 km', () => {
    const progress = routeProgress(
      [tripStop(pickup, '1.250', false), tripStop(dropoff, '2.005', false)],
      origin,
      () => false,
    );

    expect(progress.anchor).toEqual({ point: origin, km: '0.000' });
    expect(progress.pending).toHaveLength(2);
    expect(progress.next?.type).toBe('pickup');
  });

  it('pins the pickup the driver is waiting at', () => {
    const progress = routeProgress(
      [tripStop(pickup, '1.250', false), tripStop(dropoff, '2.005', false)],
      origin,
      (id) => id === 'n',
    );

    expect(progress.anchor).toEqual({ point: B, km: '1.250' });
    expect(progress.pinned?.bookingId).toBe('n');
    expect(progress.pending.map((s) => s.type)).toEqual(['dropoff']);
  });

  it('continues from the last stop reached', () => {
    const progress = routeProgress(
      [tripStop(pickup, '1.250', true), tripStop(dropoff, '2.005', false)],
      origin,
      () => false,
    );

    expect(progress.anchor).toEqual({ point: B, km: '1.250' });
    expect(progress.next?.type).toBe('dropoff');
  });
});

describe('shared km (FR-F4)', () => {
  const ride = { from: '1.000', to: '6.000' };

  it('is zero with nobody else aboard', () => {
    expect(sharedKm(ride, [])).toBe('0.000');
    expect(sharedKm(ride, [{ from: '6.000', to: '9.000' }])).toBe('0.000');
  });

  it('counts only the km both are aboard', () => {
    expect(sharedKm(ride, [{ from: '0.000', to: '4.000' }])).toBe('3.000');
    expect(sharedKm(ride, [{ from: '2.500', to: '3.750' }])).toBe('1.250');
  });

  it('counts km with two co-passengers aboard once', () => {
    const others = [
      { from: '0.000', to: '4.000' },
      { from: '3.000', to: '5.000' },
    ];

    expect(sharedKm(ride, others)).toBe('4.000');
  });

  it('adds separate stretches', () => {
    const others = [
      { from: '1.000', to: '2.000' },
      { from: '5.000', to: '8.000' },
    ];

    expect(sharedKm(ride, others)).toBe('2.000');
  });
});
