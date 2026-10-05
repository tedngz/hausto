import { describe, it, expect } from 'vitest';
import {
  assessRenter,
  digestParams,
  profileFromQuiz,
  quizBedrooms,
  quizCity,
  isoWeek,
  digestPurpose,
  newSince,
  NEW_SINCE_DAYS,
  type DigestRenter,
} from './digest.ts';
import type { ShortlistCandidate } from './intake.ts';

const listing = (over: Partial<ShortlistCandidate> = {}): ShortlistCandidate => ({
  id: 'x', is_active: true, price_vnd: 15_000_000, price_confidence: 'HIGH',
  bedrooms: 2, area_sqm: 70, district_code: 'HCM-D2', realtor_id: null, title: 'A flat', ...over,
});

const renter = (over: Partial<DigestRenter> = {}): DigestRenter => ({
  id: 'r1', display_name: 'Mai', opted_out_at: null,
  digest_opt_in_at: '2026-09-01T00:00:00Z', ...over,
});

/** A Pass holder - the digest is a Pass benefit (SPEC §11). */
const PASS = { hasPass: true };

const history = [listing({ id: 's1', price_vnd: 15_000_000 }), listing({ id: 's2', price_vnd: 16_000_000 })];
const fresh = [listing({ id: 'n1', title: 'New in Thao Dien' }), listing({ id: 'n2', title: 'Also new' })];

describe('consent, which is the whole point', () => {
  it('sends to a renter who opted in', () => {
    expect(assessRenter(renter(), history, fresh, PASS).ok).toBe(true);
  });

  it('will not send to a renter who never opted in', () => {
    // Asking us to arrange viewings is not consent for a weekly mailshot.
    const r = assessRenter(renter({ digest_opt_in_at: null }), history, fresh, PASS);
    expect(r).toEqual({ ok: false, reason: 'NOT_OPTED_IN' });
  });

  it('lets a blanket opt-out beat an opt-in', () => {
    // A renter who said STOP said it about everything, whatever they ticked
    // earlier.
    const r = assessRenter(
      renter({ opted_out_at: '2026-09-10T00:00:00Z', digest_opt_in_at: '2026-09-01T00:00:00Z' }),
      history, fresh, PASS,
    );
    expect(r).toEqual({ ok: false, reason: 'OPTED_OUT' });
  });

  it('opts nobody in by accident - the default is off', () => {
    const r = assessRenter({ id: 'r', display_name: null, opted_out_at: null, digest_opt_in_at: null }, history, fresh, PASS);
    expect(r.ok).toBe(false);
  });
});

describe('what goes in it', () => {
  it('needs a shortlist history to infer criteria from', () => {
    // The renter already told us what they want by shortlisting. Without that
    // there is nothing to match against, and guessing is worse than silence.
    expect(assessRenter(renter(), [], fresh, PASS)).toEqual({ ok: false, reason: 'NO_HISTORY' });
  });

  it('sends nothing when nothing new matches', () => {
    expect(assessRenter(renter(), history, [], PASS)).toEqual({ ok: false, reason: 'NOTHING_NEW' });
  });

  it('excludes listings they already shortlisted', () => {
    const r = assessRenter(renter(), history, [listing({ id: 's1' }), listing({ id: 'n9', title: 'Genuinely new' })], PASS);
    expect(r.ok && r.matches.map(m => m.listingId)).toEqual(['n9']);
  });

  it('holds the same price band and eligibility gate as substitutes', () => {
    const r = assessRenter(renter(), history, [
      listing({ id: 'rich', price_vnd: 60_000_000 }),
      listing({ id: 'low_conf', price_confidence: 'LOW' }),
      listing({ id: 'dead', is_active: false }),
    ], PASS);
    expect(r).toEqual({ ok: false, reason: 'NOTHING_NEW' });
  });

  it('names at most three', () => {
    const many = Array.from({ length: 8 }, (_, i) => listing({ id: `n${i}`, title: `New ${i}` }));
    const r = assessRenter(renter(), history, many, PASS);
    expect(r.ok && r.matches).toHaveLength(3);
  });
});

describe('the template parameters', () => {
  it('says how many and where, because that is what decides whether to open it', () => {
    const p = digestParams({ renterName: 'Mai', matches: [{ districtCode: 'HCM-D2' }, { districtCode: 'HCM-D2' }] });
    expect(p).toEqual(['Mai', '2', 'HCM-D2']);
  });

  it('joins two districts and abbreviates three', () => {
    expect(digestParams({ renterName: 'Mai', matches: [{ districtCode: 'A' }, { districtCode: 'B' }] })[2])
      .toBe('A and B');
    expect(digestParams({ renterName: 'Mai', matches: [{ districtCode: 'A' }, { districtCode: 'B' }, { districtCode: 'C' }] })[2])
      .toBe('A, B and elsewhere');
  });

  it('never emits an empty parameter, which Meta rejects', () => {
    const p = digestParams({ renterName: null, matches: [{ districtCode: null }] });
    expect(p[0]).toBe('there');
    expect(p[2]).toBe('Ho Chi Minh City');
    for (const v of p) expect(v.length).toBeGreaterThan(0);
  });

  it('trims a name that is only whitespace', () => {
    expect(digestParams({ renterName: '   ', matches: [{ districtCode: 'A' }] })[0]).toBe('there');
  });
});

describe('one per renter per week', () => {
  it('pins to an ISO week rather than counting seven days', () => {
    // A retry, a re-run or a second cron firing must not produce a second
    // digest. Two in a week is what loses the opt-in.
    expect(isoWeek(new Date('2026-09-14T00:00:00Z'))).toBe(isoWeek(new Date('2026-09-18T23:00:00Z')));
    expect(isoWeek(new Date('2026-09-14T00:00:00Z'))).not.toBe(isoWeek(new Date('2026-09-21T00:00:00Z')));
  });

  it('puts a week in the year containing its Thursday', () => {
    // 1 Jan 2027 is a Friday, so it belongs to the last week of 2026.
    expect(isoWeek(new Date('2027-01-01T00:00:00Z'))).toBe('2026-W53');
  });

  it('builds a purpose that changes once a week and not otherwise', () => {
    expect(digestPurpose(new Date('2026-09-14T00:00:00Z'))).toMatch(/^DIGEST:\d{4}-W\d{2}$/);
    expect(digestPurpose(new Date('2026-09-14T00:00:00Z')))
      .toBe(digestPurpose(new Date('2026-09-16T12:00:00Z')));
  });
});

describe('the window on what counts as new', () => {
  it('reaches back exactly the cadence', () => {
    expect(NEW_SINCE_DAYS).toBe(7);
    const now = new Date('2026-09-14T00:00:00Z');
    expect(newSince(now)).toBe('2026-09-07T00:00:00.000Z');
  });
});


describe('a Pass benefit (the pricing rework)', () => {
  it('waits for the Pass, however the renter ticked the box', () => {
    expect(assessRenter(renter(), history, fresh, { hasPass: false })).toEqual({ ok: false, reason: 'NO_PASS' });
  });

  it('still lets a STOP beat everything', () => {
    expect(assessRenter(renter({ opted_out_at: '2026-09-10T00:00:00Z' }), history, fresh, { hasPass: false }))
      .toEqual({ ok: false, reason: 'OPTED_OUT' });
  });

  it('falls back to the quiz for a Pass holder with no requests yet', () => {
    const quiz = profileFromQuiz({ districtCodes: ['HCM-D2'], priceMinVnd: 10_000_000, priceMaxVnd: 20_000_000, size: '["2br"]' });
    const r = assessRenter(renter(), [], fresh, { hasPass: true, quiz });
    expect(r.ok && r.matches.map(m => m.listingId)).toEqual(['n1', 'n2']);
  });

  it('holds the quiz budget as the band, not a band around its middle', () => {
    const quiz = profileFromQuiz({ districtCodes: ['HCM-D2'], priceMinVnd: 10_000_000, priceMaxVnd: 20_000_000, size: '2br' });
    const r = assessRenter(renter(), [], [
      listing({ id: 'in', price_vnd: 19_500_000 }),
      listing({ id: 'over', price_vnd: 21_000_000 }),
    ], { hasPass: true, quiz });
    expect(r.ok && r.matches.map(m => m.listingId)).toEqual(['in']);
  });
});

describe('reading the quiz', () => {
  it('reads one size or the array the quiz stores, a studio as 0', () => {
    expect(quizBedrooms('studio')).toEqual([0]);
    expect(quizBedrooms('["1br","studio"]')).toEqual([0, 1]);
    expect(quizBedrooms('4br+')).toEqual([4]);
    expect(quizBedrooms(null)).toEqual([]);
  });

  it('needs a place or a budget to match on', () => {
    expect(profileFromQuiz({ districtCodes: [], priceMinVnd: null, priceMaxVnd: null, size: '2br' })).toBeNull();
    expect(profileFromQuiz({ districtCodes: ['D1'], priceMinVnd: null, priceMaxVnd: null, size: null }))
      .toMatchObject({ districts: ['D1'], targetPriceVnd: 0 });
  });

  it('knows the city of a quiz place name', () => {
    expect(quizCity('District 1, Ho Chi Minh City')).toBe('ho_chi_minh');
    expect(quizCity('Tay Ho, Hanoi')).toBe('hanoi');
    expect(quizCity('Somewhere')).toBeNull();
  });
});

describe('twice a week', () => {
  const tuesday = new Date('2026-10-06T02:00:00Z');
  const friday = new Date('2026-10-09T02:00:00Z');

  it('keys Tuesday as it always was and Friday apart from it', () => {
    expect(digestPurpose(tuesday)).toBe('DIGEST:2026-W41');
    expect(digestPurpose(tuesday, 1)).toBe('DIGEST:2026-W41');
    expect(digestPurpose(friday, 2)).toBe('DIGEST:2026-W41:2');
  });
});
