import { describe, it, expect } from 'vitest';
import {
  alertIntro,
  alertParams,
  buildWatchLink,
  codeUsable,
  generateWatchCode,
  matchesWatch,
  planAlert,
  renderAlertDetails,
  renderWatchConfirmed,
  renderWatchProblem,
  validateWatchInput,
  watchCodeFromMessage,
  watchExpiry,
  type ActiveWatch,
  type AlertCandidate,
  type WatchListing,
} from './watch.ts';
import { refFromMessage } from './intake.ts';

const NOW = new Date('2026-09-28T03:00:00Z'); // 10:00 in HCMC

describe('the code', () => {
  it('is HW- and four unambiguous characters', () => {
    expect(generateWatchCode()).toMatch(/^HW-[34679ACDEFGHJKLMNPQRTWXY]{4}$/);
  });

  it('survives the round trip through the wa.me link', () => {
    const code = generateWatchCode();
    const link = buildWatchLink('+84901112222', code, 'Empire City');
    expect(link.startsWith('https://wa.me/84901112222?text=')).toBe(true);
    const text = decodeURIComponent(link.split('?text=')[1]);
    expect(text).toContain('Empire City');
    expect(watchCodeFromMessage(text)).toBe(code);
  });

  it('is found in any case, and not mistaken for a viewing ref', () => {
    expect(watchCodeFromMessage('alert me hw-4kx9 thanks')).toBe('HW-4KX9');
    expect(watchCodeFromMessage('my viewing request is HV-4KX2')).toBeNull();
    // And the other way: a watch message does not route to a request.
    expect(refFromMessage('alert me about Empire City (HW-4KX9)')).toBeNull();
  });

  it('stops working after a week unused, or once the watch has ended', () => {
    expect(codeUsable('2026-09-25T00:00:00Z', '2026-11-01T00:00:00Z', NOW)).toBe('OK');
    expect(codeUsable('2026-09-20T00:00:00Z', '2026-11-01T00:00:00Z', NOW)).toBe('EXPIRED');
    expect(codeUsable('2026-09-27T00:00:00Z', '2026-09-28T00:00:00Z', NOW)).toBe('EXPIRED');
  });
});

describe('what the renter asked for', () => {
  it('accepts nothing at all - any size, any price, no date', () => {
    expect(validateWatchInput({}, NOW)).toEqual({ ok: true, value: { bedrooms: null, budgetMaxVnd: null, moveInBy: null } });
  });

  it('accepts bedrooms 1 to 4, where 4 means 4+', () => {
    expect(validateWatchInput({ bedrooms: 4 }, NOW).ok).toBe(true);
    expect(validateWatchInput({ bedrooms: 0 }, NOW).ok).toBe(false);
    expect(validateWatchInput({ bedrooms: 5 }, NOW).ok).toBe(false);
    expect(validateWatchInput({ bedrooms: 2.5 }, NOW).ok).toBe(false);
  });

  it('refuses a budget that is a typo in either direction, and never a float', () => {
    expect(validateWatchInput({ budgetMaxVnd: 25_000_000 }, NOW).ok).toBe(true);
    expect(validateWatchInput({ budgetMaxVnd: 25 }, NOW).ok).toBe(false);
    expect(validateWatchInput({ budgetMaxVnd: 25_000_000_000 }, NOW).ok).toBe(false);
    expect(validateWatchInput({ budgetMaxVnd: 25_000_000.5 }, NOW).ok).toBe(false);
  });

  it('refuses a move-in date in the past or more than six months out', () => {
    expect(validateWatchInput({ moveInBy: '2026-09-28' }, NOW).ok).toBe(true);
    expect(validateWatchInput({ moveInBy: '2026-09-27' }, NOW).ok).toBe(false);
    expect(validateWatchInput({ moveInBy: '2027-06-01' }, NOW).ok).toBe(false);
    expect(validateWatchInput({ moveInBy: 'soon' }, NOW).ok).toBe(false);
  });

  it('ends a fortnight after move-in, 60 days without one, never past 120', () => {
    expect(watchExpiry(NOW, null).toISOString()).toBe('2026-11-27T03:00:00.000Z');
    expect(watchExpiry(NOW, '2026-10-15').toISOString()).toBe('2026-10-29T16:59:59.000Z');
    expect(watchExpiry(NOW, '2027-03-01').toISOString()).toBe('2027-01-26T03:00:00.000Z');
  });
});

const watch = (over: Partial<ActiveWatch> = {}): ActiveWatch => ({
  id: 'w1', complex_id: 'cx1', bedrooms: 2, budget_max_vnd: 30_000_000,
  confirmed_at: '2026-09-20T00:00:00Z', ...over,
});

const listing = (over: Partial<WatchListing> = {}): WatchListing => ({
  id: 'l1', is_active: true, price_vnd: 25_000_000, price_confidence: 'HIGH', bedrooms: 2,
  area_sqm: 80, district_code: 'D2', realtor_id: null, title: '2BR at Empire City',
  created_at: '2026-09-25T00:00:00Z', ...over,
});

describe('matching', () => {
  it('matches a new place that fits', () => {
    expect(matchesWatch(watch(), listing())).toBe(true);
  });

  it('ignores what was already there when they set it up', () => {
    // It was on the page they set the watch from.
    expect(matchesWatch(watch(), listing({ created_at: '2026-09-19T00:00:00Z' }))).toBe(false);
  });

  it('holds the bedrooms exactly, and 4 as four or more', () => {
    expect(matchesWatch(watch(), listing({ bedrooms: 3 }))).toBe(false);
    expect(matchesWatch(watch({ bedrooms: 4 }), listing({ bedrooms: 5 }))).toBe(true);
    expect(matchesWatch(watch({ bedrooms: 4 }), listing({ bedrooms: 3 }))).toBe(false);
    expect(matchesWatch(watch({ bedrooms: null }), listing({ bedrooms: 1 }))).toBe(true);
  });

  it('holds the budget as a ceiling', () => {
    expect(matchesWatch(watch(), listing({ price_vnd: 30_000_000 }))).toBe(true);
    expect(matchesWatch(watch(), listing({ price_vnd: 30_000_001 }))).toBe(false);
    expect(matchesWatch(watch({ budget_max_vnd: null }), listing({ price_vnd: 90_000_000 }))).toBe(true);
  });

  it('never alerts a place Request viewing would then refuse', () => {
    expect(matchesWatch(watch(), listing({ price_confidence: 'LOW' }))).toBe(false);
    expect(matchesWatch(watch(), listing({ is_active: false }))).toBe(false);
    expect(matchesWatch(watch(), listing({ district_code: null }))).toBe(false);
    // The same gate as a request: no floor area is still requestable, so still news.
    expect(matchesWatch(watch(), listing({ area_sqm: null }))).toBe(true);
  });
});

const cand = (over: Partial<AlertCandidate> = {}): AlertCandidate => ({
  listingId: 'l1', title: '2BR at Empire City', priceVnd: 25_000_000, bedrooms: 2,
  source: 'WATCH', watchId: 'w1', label: 'Empire City', ...over,
});

describe('one message', () => {
  it('puts watches before the digest, and holds three at most', () => {
    const plan = planAlert([
      cand({ listingId: 'd1', source: 'DIGEST', watchId: null, label: 'D2' }),
      cand({ listingId: 'd2', source: 'DIGEST', watchId: null, label: 'D2' }),
      cand({ listingId: 'w1' }),
      cand({ listingId: 'w2' }),
    ], new Set());
    expect(plan.map(p => p.listingId)).toEqual(['w1', 'w2', 'd1']);
  });

  it('never makes the same place news twice', () => {
    const plan = planAlert([cand({ listingId: 'a' }), cand({ listingId: 'a', watchId: 'w2' }), cand({ listingId: 'b' })], new Set(['b']));
    expect(plan.map(p => p.listingId)).toEqual(['a']);
  });

  it('fills the template with how many and where, mixing sources in one sentence', () => {
    expect(alertParams('Mai', [cand(), cand({ listingId: 'd', source: 'DIGEST', label: 'Thao Dien' })]))
      .toEqual(['Mai', '2', 'Empire City and Thao Dien']);
    expect(alertParams(null, [cand()])).toEqual(['there', '1', 'Empire City']);
  });
});

describe('the words', () => {
  const noEmDash = (s: string) => expect(s).not.toMatch(/[—–]/);

  it('confirms with what it is watching for, and how to stop it', () => {
    const body = renderWatchConfirmed({
      complexName: 'Empire City', bedrooms: 2, budgetMaxVnd: 30_000_000, expiresAt: '2026-11-27T03:00:00Z',
    });
    expect(body).toContain('Empire City');
    expect(body).toContain('2 bedrooms, up to 30.000.000 ₫ a month');
    expect(body).toContain('27 Nov');
    expect(body).toContain('STOP');
    noEmDash(body);
  });

  it('reads right with no criteria at all', () => {
    const body = renderWatchConfirmed({ complexName: 'Empire City', bedrooms: null, budgetMaxVnd: null, expiresAt: '2026-11-27T03:00:00Z' });
    expect(body).toContain('When a new place comes up there');
  });

  it('says what to do about a bad code', () => {
    noEmDash(renderWatchProblem('EXPIRED'));
    expect(renderWatchProblem('EXPIRED')).toContain('expired');
    expect(renderWatchProblem('UNKNOWN')).toContain('could not find');
  });

  it('lists places with a link each, pointing at Request viewing', () => {
    const body = renderAlertDetails([cand({ listingId: 'abc' })]);
    expect(body).toContain('https://hausto.com/property/abc');
    expect(body).toContain('25.000.000 ₫ a month');
    expect(body).toContain('Request viewing');
    expect(body).not.toMatch(/book/i);
    noEmDash(body);
  });

  it('says so when everything went before they answered', () => {
    expect(renderAlertDetails([])).toContain('keep watching');
  });

  it('has a free-form intro for when the window is already open', () => {
    expect(alertIntro([cand()])).toBe('A new place this week in Empire City:');
    expect(alertIntro([cand(), cand({ listingId: 'x' })])).toBe('2 new places this week in Empire City:');
  });
});
