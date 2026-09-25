import Big from 'big.js';

// Fare rules from FR §8, kept free of I/O so they are easy to test and explain (NFR-26).
// All maths is exact decimal (big.js), never floating point.

export const RIDE_OPTIONS = ['pool', 'same_gender', 'solo'] as const;
export type RideOption = (typeof RIDE_OPTIONS)[number];

const BASE_FARE = new Big('30');
const PER_KM_RATE = new Big('20');

// Same-gender pool +5%, solo +15% (FR-F2).
const OPTION_MULTIPLIERS: Record<RideOption, string> = {
  pool: '1.00',
  same_gender: '1.05',
  solo: '1.15',
};

// Each extra seat adds half the fare: 1 seat ×1.0, 2 seats ×1.5, 3 seats ×2.0 (FR-F1).
export function seatMultiplier(seats: number): Big {
  return new Big(seats).minus(1).times('0.5').plus(1);
}

export function optionMultiplier(option: RideOption): Big {
  return new Big(OPTION_MULTIPLIERS[option]);
}

// Rounded half-up to 2 decimal places, once, at the very end (FR-F5).
function toTaka(amount: Big): string {
  return amount.round(2, Big.roundHalfUp).toFixed(2);
}

// Every figure is a string, so the breakdown can be checked by hand (FR-F6).
export interface FareEstimate {
  directKm: string;
  baseFare: string;
  perKmRate: string;
  seatMultiplier: string;
  optionMultiplier: string;
  estimatedFare: string;
}

// estimate = (30 + 20 × directKm) × seatMultiplier × optionMultiplier (FR-F3).
// `directKm` is the stored 3-decimal road distance, so the result can be recomputed.
export function estimateFare(directKm: string, seats: number, option: RideOption): FareEstimate {
  const seatsFactor = seatMultiplier(seats);
  const optionFactor = optionMultiplier(option);
  const estimate = BASE_FARE.plus(PER_KM_RATE.times(directKm))
    .times(seatsFactor)
    .times(optionFactor);

  return {
    directKm,
    baseFare: BASE_FARE.toFixed(2),
    perKmRate: PER_KM_RATE.toFixed(2),
    seatMultiplier: seatsFactor.toFixed(2),
    optionMultiplier: optionFactor.toFixed(2),
    estimatedFare: toTaka(estimate),
  };
}
