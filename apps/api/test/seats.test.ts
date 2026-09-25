import { describe, expect, it } from 'vitest';
import { fitsFreeSeats, freeSeats } from '../src/domain/seats.js';

describe('freeSeats', () => {
  it('is what the passengers leave of the capacity', () => {
    expect(freeSeats(3, 0)).toBe(3);
    expect(freeSeats(3, 2)).toBe(1);
    expect(freeSeats(3, 3)).toBe(0);
  });

  it('never goes below zero', () => {
    expect(freeSeats(3, 4)).toBe(0);
  });
});

describe('fitsFreeSeats (FR-R2)', () => {
  it('fits up to the last free seat', () => {
    expect(fitsFreeSeats(3, 0, 3)).toBe(true);
    expect(fitsFreeSeats(3, 2, 1)).toBe(true);
  });

  it('refuses one seat past it', () => {
    expect(fitsFreeSeats(3, 0, 4)).toBe(false);
    expect(fitsFreeSeats(3, 2, 2)).toBe(false);
    expect(fitsFreeSeats(3, 3, 1)).toBe(false);
  });
});
