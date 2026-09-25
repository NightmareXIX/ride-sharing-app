import { describe, expect, it } from 'vitest';
import { estimateFare, optionMultiplier, seatMultiplier } from '../src/domain/fare.js';

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
