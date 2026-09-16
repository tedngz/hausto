import { describe, it, expect } from 'vitest';
import {
  generateRef,
  isValidRef,
  refFromMessage,
  validateAvailability,
  validateShortlist,
  DAY_PARTS,
  MIN_LEAD_DAYS,
  screenCandidates,
  intakeEvents,
  buildDeepLink,
  formatVnd,
  hcmcDate,
  addDays,
  toE164,
  type ShortlistCandidate,
} from './intake.ts';

describe('refs', () => {
  it('generates a ref of the documented shape', () => {
    for (let i = 0; i < 200; i++) expect(isValidRef(generateRef())).toBe(true);
  });

  it('never emits a character that is misheard over a phone', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) for (const c of generateRef().slice(3)) seen.add(c);
    for (const ambiguous of ['I', 'O', '0', '1', 'S', '5', 'Z', '2', 'U', 'V', 'B', '8']) {
      expect(seen.has(ambiguous)).toBe(false);
    }
  });

  it('finds a ref inside a renter message, case-insensitively', () => {
    expect(refFromMessage('Hi Hausto - my viewing request is HV-4KX7')).toBe('HV-4KX7');
    expect(refFromMessage('hv-4kx7 please')).toBe('HV-4KX7');
    expect(refFromMessage('no ref here')).toBeNull();
    // The alphabet excludes O and 0, so a lookalike is not a match.
    expect(refFromMessage('HV-4KO7')).toBeNull();
  });
});

describe('availability', () => {
  const today = '2026-09-11';
  // today + MIN_LEAD_DAYS. The first date anyone can actually pick.
  const earliest = '2026-09-13';

  it('accepts chips inside the window and sorts them', () => {
    const r = validateAvailability(
      [{ date: '2026-09-14', part: 'MORNING' }, { date: earliest, part: 'EVENING' },
       { date: earliest, part: 'MORNING' }],
      today,
    );
    expect(r.ok).toBe(true);
    expect(r.value).toEqual([
      { date: earliest, part: 'MORNING' },
      { date: earliest, part: 'EVENING' },
      { date: '2026-09-14', part: 'MORNING' },
    ]);
  });

  it('collapses a double tap rather than rejecting it', () => {
    const r = validateAvailability(
      [{ date: earliest, part: 'MORNING' }, { date: earliest, part: 'MORNING' }],
      today,
    );
    expect(r.ok).toBe(true);
    expect(r.value).toHaveLength(1);
  });

  it('rejects empty, past, too-far and malformed windows', () => {
    expect(validateAvailability([], today).ok).toBe(false);
    expect(validateAvailability([{ date: '2026-09-10', part: 'MORNING' }], today).ok).toBe(false);
    expect(validateAvailability([{ date: '2026-10-30', part: 'MORNING' }], today).ok).toBe(false);
    expect(validateAvailability([{ date: 'tuesday', part: 'MORNING' }], today).ok).toBe(false);
    expect(validateAvailability([{ date: earliest, part: 'NIGHT' }], today).ok).toBe(false);
  });

  it('refuses today and tomorrow, whatever the time of day', () => {
    // The buffer. An operator has to reach every realtor on the shortlist, on
    // Zalo, and wait for each to answer - so "this evening" is a request
    // nobody can fill. This test previously asserted the opposite ("accepts
    // today itself"), which documented the absence of the buffer rather than
    // a rule worth keeping.
    for (const part of DAY_PARTS) {
      expect(validateAvailability([{ date: today, part }], today).ok).toBe(false);
      expect(validateAvailability([{ date: addDays(today, 1), part }], today).ok).toBe(false);
    }
  });

  it('accepts the first day past the buffer', () => {
    expect(validateAvailability([{ date: earliest, part: 'EVENING' }], today).ok).toBe(true);
    expect(addDays(today, MIN_LEAD_DAYS)).toBe(earliest);
  });

  it('says how long the wait is rather than just refusing', () => {
    const r = validateAvailability([{ date: today, part: 'MORNING' }], today);
    expect(r.ok).toBe(false);
    expect(r.error).toContain(earliest);
  });
});

describe('the local calendar date', () => {
  it('is tomorrow in Saigon while it is still today in UTC', () => {
    // 18:00 UTC on the 11th is 01:00 on the 12th in Ho Chi Minh City. A picker
    // validating against the UTC date would reject the renter's "tomorrow".
    expect(hcmcDate(new Date('2026-09-11T18:00:00Z'))).toBe('2026-09-12');
    expect(hcmcDate(new Date('2026-09-11T16:00:00Z'))).toBe('2026-09-11');
  });

  it('adds days without a timezone anywhere near it', () => {
    expect(addDays('2026-09-11', 14)).toBe('2026-09-25');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('the shortlist gate', () => {
  it('holds the 1-to-5 bound', () => {
    const id = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;
    // One is a request. The floor used to be three, which refused the single
    // most common thing a renter wants to do.
    expect(validateShortlist([]).ok).toBe(false);
    expect(validateShortlist([id(1)]).ok).toBe(true);
    expect(validateShortlist([id(1), id(2), id(3)]).ok).toBe(true);
    expect(validateShortlist([id(1), id(2), id(3), id(4), id(5)]).ok).toBe(true);
    // The ceiling is the constraint that survives: six cannot be seen in a day.
    expect(validateShortlist([id(1), id(2), id(3), id(4), id(5), id(6)]).ok).toBe(false);
  });

  it('dedupes before counting, so six taps on five listings still fits', () => {
    const id = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;
    const r = validateShortlist([id(1), id(1), id(2), id(2), id(3), id(4), id(5)]);
    expect(r.ok).toBe(true);
    expect(r.value).toHaveLength(5);
  });

  it('rejects anything that is not a listing id', () => {
    expect(validateShortlist(['../../etc/passwd', 'x', 'y']).ok).toBe(false);
  });
});

describe('screening candidates', () => {
  const ok = (over: Partial<ShortlistCandidate> = {}): ShortlistCandidate => ({
    id: 'a', is_active: true, price_vnd: 15_000_000, price_confidence: 'HIGH',
    bedrooms: 2, area_sqm: 70, district_code: 'HCM-BINH-THANH', realtor_id: null,
    title: 'A flat', ...over,
  });

  it('passes a complete, live, high-confidence row', () => {
    const { eligible, rejected } = screenCandidates(['a'], [ok()]);
    expect(eligible).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it('excludes LOW price confidence - searchable is not shortlistable', () => {
    const { eligible, rejected } = screenCandidates(['a'], [ok({ price_confidence: 'LOW' })]);
    expect(eligible).toHaveLength(0);
    expect(rejected[0].reason).toMatch(/price/i);
  });

  it('rejects a row missing any canonical column', () => {
    for (const missing of [{ price_vnd: null }, { bedrooms: null }, { area_sqm: null }, { district_code: null }]) {
      const { eligible } = screenCandidates(['a'], [ok(missing as Partial<ShortlistCandidate>)]);
      expect(eligible).toHaveLength(0);
    }
  });

  it('rejects a listing that went inactive or vanished between shortlist and submit', () => {
    expect(screenCandidates(['a'], [ok({ is_active: false })]).eligible).toHaveLength(0);
    expect(screenCandidates(['a'], []).rejected[0].reason).toMatch(/no longer exists/);
  });

  it('reports partial eligibility rather than failing the whole shortlist', () => {
    // Partial success is the happy path (CLAUDE.md invariant 5) and it starts
    // here, not at the ops console.
    const { eligible, rejected } = screenCandidates(
      ['a', 'b', 'c'],
      [ok({ id: 'a' }), ok({ id: 'b', is_active: false }), ok({ id: 'c' })],
    );
    expect(eligible.map(e => e.id)).toEqual(['a', 'c']);
    expect(rejected.map(r => r.listingId)).toEqual(['b']);
  });
});

describe('the events an intake writes', () => {
  const base = {
    requestId: 'req-1',
    availability: [{ date: '2026-09-12', part: 'MORNING' as const }],
  };

  it('writes REQUEST_SUBMITTED then one ITEM_ADDED per item', () => {
    const events = intakeEvents({
      ...base,
      items: [
        { itemId: 'i1', listingId: 'l1', priceVndAtRequest: 15_000_000, realtorId: null },
        { itemId: 'i2', listingId: 'l2', priceVndAtRequest: 22_000_000, realtorId: null },
      ],
    });
    expect(events.map(e => e.type)).toEqual(['REQUEST_SUBMITTED', 'ITEM_ADDED', 'ITEM_ADDED']);
    expect(events[0].payload.availability).toEqual(base.availability);
    expect(events[1].payload).toEqual({ listing_id: 'l1', price_vnd_at_request: 15_000_000 });
  });

  it('emits REALTOR_RESOLVED only where the listing already knows its broker', () => {
    const events = intakeEvents({
      ...base,
      items: [
        { itemId: 'i1', listingId: 'l1', priceVndAtRequest: 1, realtorId: 'r1' },
        { itemId: 'i2', listingId: 'l2', priceVndAtRequest: 1, realtorId: null },
      ],
    });
    const resolved = events.filter(e => e.type === 'REALTOR_RESOLVED');
    expect(resolved).toHaveLength(1);
    expect(resolved[0].item_id).toBe('i1');
    expect(resolved[0].payload).toEqual({ realtor_id: 'r1', method: 'AGENT_ID' });
    expect(resolved[0].actor).toBe('SYSTEM');
  });

  it('attributes the intake to the renter, not to us', () => {
    const events = intakeEvents({ ...base, items: [] });
    expect(events[0].actor).toBe('RENTER');
  });
});

describe('the handshake', () => {
  it('builds a wa.me link the renter can only send, never receive on', () => {
    const link = buildDeepLink('+84901234567', 'HV-4KX7');
    expect(link).toBe('https://wa.me/84901234567?text=Hi%20Hausto%20-%20my%20viewing%20request%20is%20HV-4KX7');
  });

  it('round-trips: the link text carries a ref the inbound parser finds', () => {
    const ref = generateRef();
    const text = decodeURIComponent(buildDeepLink('+84901234567', ref).split('?text=')[1]);
    expect(refFromMessage(text)).toBe(ref);
  });
});

describe('conventions', () => {
  it('formats dong the Vietnamese way', () => {
    expect(formatVnd(15_000_000)).toBe('15.000.000 ₫');
    expect(formatVnd(2_800_000)).toBe('2.800.000 ₫');
    expect(formatVnd(950)).toBe('950 ₫');
  });

  it('normalizes every shape the renter might type', () => {
    for (const raw of ['0901234567', '84901234567', '+84 90 123 45 67', '+84901234567']) {
      expect(toE164(raw)).toBe('+84901234567');
    }
    expect(toE164('12345')).toBeNull();
  });
});
