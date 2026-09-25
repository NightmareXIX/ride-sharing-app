import { describe, expect, it } from 'vitest';
import { estimateFare, finalFare, optionMultiplier, seatMultiplier } from '../src/domain/fare.js';

describe('seat and option multipliers (FR-F1, FR-F2)', () => {
  it.each([
    [1, '1.00'],
    [2, '1.50'],
    [3, '2.00'],
    [6, '3.50'],
  ])('%i seat(s) cost ×%s', (seats, multiplier) => {
    expect(seatMultiplier(seats).toFixed(2)).toBe(multiplier);
  });

  it.each([
    ['pool', '1.00'],
    ['same_gender', '1.05'],
    ['solo', '1.15'],
  ] as const)('%s costs ×%s', (option, multiplier) => {
    expect(optionMultiplier(option).toFixed(2)).toBe(multiplier);
  });
});

describe('fare estimate (FR-F3)', () => {
  // The worked examples in FR §8, priced at request time from the 5 km direct distance.
  it.each([
    ['Pool, 1 seat', 1, 'pool', '130.00'],
    ['Pool, 2 seats', 2, 'pool', '195.00'],
    ['Same-gender, 2 seats', 2, 'same_gender', '204.75'],
    ['Solo, 1 seat', 1, 'solo', '149.50'],
  ] as const)('prices a 5 km trip, %s, at %s', (_name, seats, option, fare) => {
    expect(estimateFare('5.000', seats, option).estimatedFare).toBe(fare);
  });

  it('shows every step of the calculation as a string', () => {
    expect(estimateFare('2.345', 2, 'same_gender')).toEqual({
      directKm: '2.345',
      baseFare: '30.00',
      perKmRate: '20.00',
      seatMultiplier: '1.50',
      optionMultiplier: '1.05',
      // (30 + 46.90) × 1.5 × 1.05 = 121.1175
      estimatedFare: '121.12',
    });
  });

  it('rounds a half cent up, not to even', () => {
    // (30 + 40.10) × 1.05 = 73.605 exactly
    expect(estimateFare('2.005', 1, 'same_gender').estimatedFare).toBe('73.61');
  });

  it('uses exact decimals where floating point would drift', () => {
    // In floating point, (30 + 20 × 0.115) × 1.15 comes out just below 37.145.
    expect((30 + 20 * 0.115) * 1.15).toBeLessThan(37.145);
    expect(estimateFare('0.115', 1, 'solo').estimatedFare).toBe('37.15');
  });
});

describe('final fare (FR-F4, FR-F5)', () => {
  // FR §8: direct 5 km, rides 5.5 km, shares 3 km with another booking.
  const POOLED = { directKm: '5.000', actualKm: '5.500', sharedKm: '3.000' };

  it.each([
    ['Pool, 1 seat', 1, 'pool', '116.00'],
    ['Pool, 2 seats', 2, 'pool', '174.00'],
    ['Same-gender, 2 seats', 2, 'same_gender', '182.70'],
  ] as const)('prices the worked pooled trip, %s, at %s', (_name, seats, option, fare) => {
    expect(finalFare(POOLED, seats, option).finalFare).toBe(fare);
  });

  it('prices a solo trip at its estimate', () => {
    const solo = finalFare({ directKm: '5.000', actualKm: '5.000', sharedKm: '0.000' }, 1, 'solo');
    expect(solo.computedFare).toBe('149.50');
    expect(solo.finalFare).toBe('149.50');
  });

  it('never charges more than the estimate (FR-P4)', () => {
    // A 2 km detour with nobody to share it: computed 170.00, estimate 130.00.
    const fare = finalFare({ directKm: '5.000', actualKm: '7.000', sharedKm: '0.000' }, 1, 'pool');
    expect(fare.computedFare).toBe('170.00');
    expect(fare.estimatedFare).toBe('130.00');
    expect(fare.finalFare).toBe('130.00');
  });

  it('shows every step of the calculation as a string (FR-F6)', () => {
    expect(finalFare(POOLED, 2, 'same_gender')).toEqual({
      directKm: '5.000',
      actualKm: '5.500',
      sharedKm: '3.000',
      baseFare: '30.00',
      perKmRate: '20.00',
      sharedKmDiscount: '8.00',
      seatMultiplier: '1.50',
      optionMultiplier: '1.05',
      estimatedFare: '204.75',
      // (30 + 110 − 24) × 1.5 × 1.05
      computedFare: '182.70',
      finalFare: '182.70',
    });
  });

  it('rounds the final fare half-up, once', () => {
    // (30 + 40.10) × 1.05 = 73.605 exactly, below the 3 km estimate.
    const fare = finalFare(
      { directKm: '3.000', actualKm: '2.005', sharedKm: '0.000' },
      1,
      'same_gender',
    );
    expect(fare.finalFare).toBe('73.61');
  });
});
