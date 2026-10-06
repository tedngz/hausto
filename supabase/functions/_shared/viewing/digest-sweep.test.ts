// The Pass digest, on MockAdapter with seeded data (pricing rework, step 4).
//
// Done when a Pass holder with only quiz answers gets a Friday digest in the
// new wording, and a free renter gets none - and when the Friday run neither
// repeats Tuesday's places nor carries complex watches, which stay weekly.

import { describe, it, expect, beforeEach } from 'vitest';
import { FakeDb } from './fake-db.ts';
import { MockAdapter } from '../whatsapp/adapter.ts';
import { SupabaseMessageStore } from '../whatsapp/store.ts';
import { runDigestSweep } from './digest-sweep.ts';

const NOW = new Date('2026-10-09T02:00:00Z'); // Friday 09:00 in Ho Chi Minh City
let db: FakeDb;
let adapter: MockAdapter;
let store: SupabaseMessageStore;

const windowOpen = new Date(NOW.getTime() + 6 * 3600_000).toISOString();

function seed() {
  db = new FakeDb();
  adapter = new MockAdapter();
  // deno-lint-ignore no-explicit-any
  store = new SupabaseMessageStore(db as any);

  // Both opted in; only one holds the Pass. Neither has made a request.
  db.tables.renters.push(
    { id: 'r-pass', phone_e164: '+84901111111', user_id: 'u-pass', display_name: 'Mai',
      digest_opt_in_at: '2026-10-01T00:00:00Z', opted_out_at: null, service_window_expires_at: windowOpen },
    { id: 'r-free', phone_e164: '+84902222222', user_id: 'u-free', display_name: 'Tom',
      digest_opt_in_at: '2026-10-01T00:00:00Z', opted_out_at: null, service_window_expires_at: windowOpen },
  );
  db.passHolders.add('u-pass');

  // What the Pass holder told the quiz: District 2, 10-20M, two bedrooms.
  db.tables.user_preferences = [
    { user_id: 'u-pass', location: ['District 2, Ho Chi Minh City'], price_range_min: 10_000_000, price_range_max: 20_000_000, size: '2br' },
    { user_id: 'u-free', location: ['District 2, Ho Chi Minh City'], price_range_min: 10_000_000, price_range_max: 20_000_000, size: '2br' },
  ];
  db.rpcResults.vn_district_code = (a) => (String(a._location).startsWith('District 2') ? 'D2' : null);

  // New this week: two that fit, one out of their range, one elsewhere.
  const listing = (id: string, over: Record<string, unknown>) => ({
    id, title: id, is_active: true, price_vnd: 15_000_000, price_confidence: 'HIGH', bedrooms: 2, area_sqm: 70,
    district_code: 'D2', realtor_id: null, created_at: '2026-10-07T00:00:00Z', ...over,
  });
  db.tables.external_properties.push(
    listing('Bright 2BR, Thao Dien', {}),
    listing('Quiet 2BR, An Phu', { price_vnd: 18_000_000 }),
    listing('Penthouse, Thao Dien', { price_vnd: 60_000_000 }),
    listing('2BR, District 7', { district_code: 'D7' }),
  );
  db.tables.alert_items = [];
}

const outbound = (renterPhone: string) =>
  db.tables.messages.filter(m => m.direction === 'OUT' && m.to_phone === renterPhone);

beforeEach(seed);

describe('the Friday digest', () => {
  it('reaches the Pass holder from their quiz, in the new wording, and not the free renter', async () => {
    // deno-lint-ignore no-explicit-any
    const summary = await runDigestSweep(db as any, store, adapter, { run: 2, send: true, now: NOW });
    expect(summary).toMatchObject({ run: 2, sent: 1, eligible: 1 });
    expect(summary.skipped.NO_PASS).toBe(1);

    const sent = outbound('+84901111111');
    expect(sent).toHaveLength(1);
    const body = String(sent[0].body);
    // REHEARSAL_PRINT=1 npx vitest run digest-sweep - the words, to read.
    if (process.env.REHEARSAL_PRINT === '1') console.log(`\n  ── Friday digest, window open ──\n${body}\n`);
    // District ranks first but does not exclude - the same ranker as the
    // shortlist-based digest - and the quiz budget is the band.
    expect(body).toContain('3 new places in D2 and D7 fit what you are looking for');
    expect(body.indexOf('Bright 2BR, Thao Dien')).toBeLessThan(body.indexOf('2BR, District 7'));
    expect(body).toContain('Quiet 2BR, An Phu');
    expect(body).not.toContain('Penthouse');
    expect(body).not.toContain('this week');
    expect(outbound('+84902222222')).toHaveLength(0);
  });

  it('waits for new_places to be approved when the window is shut', async () => {
    db.tables.renters[0].service_window_expires_at = null;
    // deno-lint-ignore no-explicit-any
    const summary = await runDigestSweep(db as any, store, adapter, { run: 2, send: true, now: NOW });
    expect(summary).toMatchObject({ sent: 0, refused: 1 });
    expect(adapter.delivered).toHaveLength(0);
  });

  it('never repeats a place, and sends once per run', async () => {
    // deno-lint-ignore no-explicit-any
    await runDigestSweep(db as any, store, adapter, { run: 2, send: true, now: NOW });
    // deno-lint-ignore no-explicit-any
    const again = await runDigestSweep(db as any, store, adapter, { run: 2, send: true, now: NOW });
    expect(again.sent).toBe(0);
    expect(outbound('+84901111111')).toHaveLength(1);
  });

  it('carries no complex watches - they stay weekly, on Tuesday', async () => {
    db.tables.complex_watches = [{
      id: 'w1', complex_id: 'c1', renter_id: 'r-free', status: 'ACTIVE', bedrooms: null, budget_max_vnd: null,
      expires_at: '2026-12-01T00:00:00Z', confirmed_at: '2026-10-01T00:00:00Z',
    }];
    // deno-lint-ignore no-explicit-any
    const summary = await runDigestSweep(db as any, store, adapter, { run: 2, send: true, now: NOW });
    expect(summary.active_watches).toBe(0);
    expect(outbound('+84902222222')).toHaveLength(0);
  });
});
