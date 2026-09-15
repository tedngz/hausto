import { describe, it, expect } from 'vitest';
import {
  assessRenter,
  digestParams,
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

const history = [listing({ id: 's1', price_vnd: 15_000_000 }), listing({ id: 's2', price_vnd: 16_000_000 })];
const fresh = [listing({ id: 'n1', title: 'New in Thao Dien' }), listing({ id: 'n2', title: 'Also new' })];

describe('consent, which is the whole point', () => {
  it('sends to a renter who opted in', () => {
    expect(assessRenter(renter(), history, fresh).ok).toBe(true);
  });

  it('will not send to a renter who never opted in', () => {
    // Asking us to arrange viewings is not consent for a weekly mailshot.
    const r = assessRenter(renter({ digest_opt_in_at: null }), history, fresh);
    expect(r).toEqual({ ok: false, reason: 'NOT_OPTED_IN' });
  });

  it('lets a blanket opt-out beat an opt-in', () => {
    // A renter who said STOP said it about everything, whatever they ticked
    // earlier.
    const r = assessRenter(
      renter({ opted_out_at: '2026-09-10T00:00:00Z', digest_opt_in_at: '2026-09-01T00:00:00Z' }),
      history, fresh,
    );
    expect(r).toEqual({ ok: false, reason: 'OPTED_OUT' });
  });

  it('opts nobody in by accident - the default is off', () => {
    const r = assessRenter({ id: 'r', display_name: null, opted_out_at: null, digest_opt_in_at: null }, history, fresh);
    expect(r.ok).toBe(false);
  });
});

describe('what goes in it', () => {
  it('needs a shortlist history to infer criteria from', () => {
    // The renter already told us what they want by shortlisting. Without that
    // there is nothing to match against, and guessing is worse than silence.
    expect(assessRenter(renter(), [], fresh)).toEqual({ ok: false, reason: 'NO_HISTORY' });
  });

  it('sends nothing when nothing new matches', () => {
    expect(assessRenter(renter(), history, [])).toEqual({ ok: false, reason: 'NOTHING_NEW' });
  });

  it('excludes listings they already shortlisted', () => {
    const r = assessRenter(renter(), history, [listing({ id: 's1' }), listing({ id: 'n9', title: 'Genuinely new' })]);
    expect(r.ok && r.matches.map(m => m.listingId)).toEqual(['n9']);
  });

  it('holds the same price band and eligibility gate as substitutes', () => {
    const r = assessRenter(renter(), history, [
      listing({ id: 'rich', price_vnd: 60_000_000 }),
      listing({ id: 'low_conf', price_confidence: 'LOW' }),
      listing({ id: 'dead', is_active: false }),
    ]);
    expect(r).toEqual({ ok: false, reason: 'NOTHING_NEW' });
  });

  it('names at most three', () => {
    const many = Array.from({ length: 8 }, (_, i) => listing({ id: `n${i}`, title: `New ${i}` }));
    const r = assessRenter(renter(), history, many);
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
