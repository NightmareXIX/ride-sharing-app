import { describe, expect, it } from 'vitest';
import { RIDE_OPTIONS, type RideOption } from '../src/domain/fare.js';
import { canJoin, joinRule, type Gender, type Rider } from '../src/domain/rideOptions.js';

const rider = (rideOption: RideOption, gender: Gender): Rider => ({ rideOption, gender });

const woman = (option: RideOption = 'pool') => rider(option, 'female');
const man = (option: RideOption = 'pool') => rider(option, 'male');

describe('canJoin (FR-R10, FR-L3(f))', () => {
  it.each(RIDE_OPTIONS)('lets an idle Tesla take a %s request (FR-D6)', (option) => {
    expect(canJoin([], woman(option))).toEqual({ ok: true });
    expect(canJoin([], man(option))).toEqual({ ok: true });
  });

  it.each(RIDE_OPTIONS)('keeps a %s request out of a solo ride', (option) => {
    expect(canJoin([man('solo')], man(option))).toEqual({
      ok: false,
      reason: 'TESLA_ON_SOLO_RIDE',
    });
  });

  it.each([
    ['a Pool rider', [man()]],
    ['a Same-gender rider of the same gender', [man('same_gender')]],
  ])('keeps a Solo request out of a Tesla with %s', (_, riders) => {
    expect(canJoin(riders, man('solo'))).toEqual({ ok: false, reason: 'SOLO_NEEDS_EMPTY_TESLA' });
  });

  it('lets a Same-gender request join riders who all share its gender', () => {
    expect(canJoin([woman(), woman('same_gender')], woman('same_gender'))).toEqual({ ok: true });
  });

  it('keeps a Same-gender request out of a mixed trip or one of the other gender', () => {
    const mismatch = { ok: false, reason: 'GENDER_MISMATCH' };
    expect(canJoin([woman(), man()], woman('same_gender'))).toEqual(mismatch);
    expect(canJoin([man()], woman('same_gender'))).toEqual(mismatch);
  });

  it('holds a Same-gender trip to its gender, whatever the newcomer chose', () => {
    const mismatch = { ok: false, reason: 'GENDER_MISMATCH' };
    expect(canJoin([woman('same_gender')], man())).toEqual(mismatch);
    expect(canJoin([man('same_gender')], woman())).toEqual(mismatch);
    expect(canJoin([woman('same_gender')], woman())).toEqual({ ok: true });
    expect(canJoin([man('same_gender')], man())).toEqual({ ok: true });
  });

  it('lets Pool riders of either gender share', () => {
    expect(canJoin([woman()], man())).toEqual({ ok: true });
    expect(canJoin([man(), woman()], man())).toEqual({ ok: true });
  });
});

describe('joinRule', () => {
  it('lets anyone into an idle Tesla or a Pool trip', () => {
    expect(joinRule([])).toBe('anyone');
    expect(joinRule([woman(), man()])).toBe('anyone');
  });

  it('lets no one into a solo ride', () => {
    expect(joinRule([woman('solo')])).toBe('no_one');
  });

  it('lets only the Same-gender rider’s gender in', () => {
    expect(joinRule([woman(), woman('same_gender')])).toBe('women');
    expect(joinRule([man('same_gender')])).toBe('men');
  });
});
