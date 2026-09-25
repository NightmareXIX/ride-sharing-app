import type { RideOption } from './fare.js';

// Who may share a Tesla, by ride option (FR-R10, FR-L3(f)). Kept free of I/O so the rule is
// easy to test (NFR-26). Seats are the seat claim's job and the route the matching rule's;
// this only says whether the options allow it.

export type Gender = 'female' | 'male';

// A booking in the Tesla, or a request that wants to join it.
export interface Rider {
  rideOption: RideOption;
  gender: Gender;
}

export type OptionConflict = 'TESLA_ON_SOLO_RIDE' | 'SOLO_NEEDS_EMPTY_TESLA' | 'GENDER_MISMATCH';

export type JoinVerdict = { ok: true } | { ok: false; reason: OptionConflict };

// Whether `candidate` may join a Tesla carrying `riders`: its bookings that are accepted,
// waited for or aboard. The driver's gender is never considered (FR-R10).
export function canJoin(riders: readonly Rider[], candidate: Rider): JoinVerdict {
  // An idle Tesla takes any option, Solo included (FR-D6).
  if (riders.length === 0) return { ok: true };
  // A Solo booking locks the Tesla while it is active.
  if (riders.some((rider) => rider.rideOption === 'solo')) {
    return { ok: false, reason: 'TESLA_ON_SOLO_RIDE' };
  }
  if (candidate.rideOption === 'solo') return { ok: false, reason: 'SOLO_NEEDS_EMPTY_TESLA' };
  // A Same-gender booking shares only with its own gender, whichever side asked for it.
  const sameGender = [candidate, ...riders].some((rider) => rider.rideOption === 'same_gender');
  if (sameGender && riders.some((rider) => rider.gender !== candidate.gender)) {
    return { ok: false, reason: 'GENDER_MISMATCH' };
  }
  return { ok: true };
}

// Who the rule still lets into a Tesla, for the driver's screen. With `anyone`, a
// Same-gender request still joins only if every rider matches it.
export type JoinRule = 'anyone' | 'no_one' | 'women' | 'men';

export function joinRule(riders: readonly Rider[]): JoinRule {
  if (riders.some((rider) => rider.rideOption === 'solo')) return 'no_one';
  const sameGender = riders.find((rider) => rider.rideOption === 'same_gender');
  if (!sameGender) return 'anyone';
  return sameGender.gender === 'female' ? 'women' : 'men';
}
