// The complex-watch conversation, end to end, printed (SPEC §11).
//
// Same idea as rehearsal.test.ts: the FakeDb, the MockAdapter, and the real
// handleInbound / decideAction / performAction / sendAlert - so the words
// below are the words a renter gets. Silent unless:
//
//   REHEARSAL_PRINT=1 npx vitest run rehearsal

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FakeDb } from './fake-db.ts';
import { MockAdapter } from '../whatsapp/adapter.ts';
import { SupabaseMessageStore } from '../whatsapp/store.ts';
import { handleInbound } from './routing.ts';
import { decideAction } from './agent.ts';
import { performAction } from './agent-act.ts';
import { sendAlert } from './alerts.ts';
import {
  buildWatchLink, generateWatchCode, matchesWatch, planAlert, watchExpiry,
  type ActiveWatch, type AlertCandidate, type WatchListing,
} from './watch.ts';

const PHONE = '+84901234567';
const BUSINESS = '+84901112222';
const PRINT = process.env.REHEARSAL_PRINT === '1';

// docs/whatsapp-go-live.md, as submitted and approved.
const WEEKLY_DIGEST = 'Hi {{1}}, there are {{2}} new places this week in {{3}}. Reply here if you would like to see them.';

function say(who: string, body: string) {
  if (!PRINT) return;
  const rule = '─'.repeat(64);
  console.log(`\n${rule}\n  ${who}\n${rule}`);
  console.log(body.split('\n').map(l => '  ' + l).join('\n'));
}

let db: FakeDb;
let adapter: MockAdapter;
let store: SupabaseMessageStore;
let code: string;

function at(iso: string) { vi.setSystemTime(new Date(iso)); }

function seed() {
  db = new FakeDb();
  adapter = new MockAdapter();
  // deno-lint-ignore no-explicit-any
  store = new SupabaseMessageStore(db as any);
  db.tables.complexes = [{ id: 'cx-1', name: 'Empire City' }];
  code = generateWatchCode();
  const now = new Date();
  db.tables.complex_watches = [{
    id: 'watch-1', complex_id: 'cx-1', code, user_id: 'user-1', renter_id: null,
    bedrooms: 2, budget_max_vnd: 30_000_000, move_in_by: null, status: 'PENDING',
    confirmed_at: null, expires_at: watchExpiry(now, null).toISOString(), created_at: now.toISOString(),
  }];
}

/** An inbound, and whatever single reply the webhook would send to it. */
async function inbound(text: string, from = PHONE) {
  say('Renter', text);
  // deno-lint-ignore no-explicit-any
  const outcome = await handleInbound(db as any, store, {
    from, text, providerMessageId: `wamid.${Math.random()}`, timestamp: new Date().toISOString(),
  });
  // The production switch: VIEWING_AGENT_ENABLED is not set.
  const action = decideAction({
    enabled: false, intent: outcome.intent, text, requestId: outcome.requestId,
    optedOut: outcome.optedOut, confirmed: outcome.confirmed, selection: outcome.selection,
    watch: outcome.watch, alertMessageId: outcome.alertMessageId,
  });
  let reply: string | undefined;
  if (action.kind !== 'NONE' && action.kind !== 'SEARCH') {
    // deno-lint-ignore no-explicit-any
    const result = await performAction(db as any, adapter, action, {
      renterId: outcome.renterId, requestId: outcome.requestId, providerMessageId: 'wamid.x',
    });
    expect(result.error).toBeUndefined();
    reply = String(db.tables.messages.find(m => m.id === result.messageId)?.body ?? '');
    say('Hausto', reply);
  }
  return { outcome, action, reply };
}

/** What the sweep does for one renter, over the FakeDb. */
async function sweepFor(renterId: string) {
  const watches = db.tables.complex_watches
    .filter(w => w.renter_id === renterId && w.status === 'ACTIVE') as unknown as ActiveWatch[];
  const listings = db.tables.external_properties as unknown as (WatchListing & { complex_id: string })[];
  const candidates: AlertCandidate[] = [];
  for (const w of watches) {
    for (const l of listings.filter(l => l.complex_id === w.complex_id)) {
      if (matchesWatch(w, l)) {
        candidates.push({
          listingId: l.id, title: l.title, priceVnd: l.price_vnd, bedrooms: l.bedrooms,
          source: 'WATCH', watchId: w.id, label: 'Empire City',
        });
      }
    }
  }
  const alerted = new Set(db.tables.alert_items?.filter(a => a.renter_id === renterId).map(a => String(a.listing_id)));
  const items = planAlert(candidates, alerted);
  // deno-lint-ignore no-explicit-any
  const result = await sendAlert(db as any, store, adapter, { renterId, renterName: null, items, now: new Date() });
  const sent = adapter.delivered[adapter.delivered.length - 1];
  if (result.sent && sent.templateName) {
    let body = WEEKLY_DIGEST;
    (sent.templateParams ?? []).forEach((p, i) => { body = body.replace(`{{${i + 1}}}`, p); });
    say(`Hausto  [template ${sent.templateName}]`, body);
  } else if (result.sent) {
    say('Hausto', String(sent.body));
  }
  return { result, items };
}

function listing(id: string, over: Record<string, unknown>) {
  db.tables.external_properties.push({
    id, complex_id: 'cx-1', is_active: true, price_vnd: 25_000_000, price_confidence: 'HIGH',
    bedrooms: 2, area_sqm: 78, district_code: 'HCM-D2', realtor_id: null,
    created_at: new Date().toISOString(), ...over,
  });
}

describe('complex watch rehearsal', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-09-28T03:00:00Z');
    seed();
  });
  afterEach(() => vi.useRealTimers());

  it('plays the whole thing: code, confirmation, alert, places, stop', async () => {
    if (PRINT) console.log('\n\n══ REHEARSAL - complex watch, Empire City ══');

    // Already listed when they set it up - they saw it on the page.
    listing('l-before', { title: 'Old 2BR, Empire City', created_at: '2026-09-20T00:00:00Z' });

    const link = buildWatchLink(BUSINESS, code, 'Empire City');
    if (PRINT) console.log(`\n  The link on the complex page:\n  ${link}`);

    // 1. They send the code. The watch turns on and says what it is for.
    at('2026-09-28T03:05:00Z');
    const first = await inbound(decodeURIComponent(link.split('?text=')[1]));
    expect(first.action.kind).toBe('WATCH_CONFIRMED');
    expect(first.outcome.requestId).toBeUndefined();
    const w = db.tables.complex_watches[0];
    expect(w.status).toBe('ACTIVE');
    expect(w.renter_id).toBe(first.outcome.renterId);
    // The account that set it up is now linked to the phone.
    expect(db.tables.renters[0].user_id).toBe('user-1');
    expect(first.reply).toContain('Empire City');

    // 2. Six days on, three new listings: one fits, one is dear, one is big.
    at('2026-10-03T00:00:00Z');
    listing('l-fits', { title: 'Bright 2BR, Empire City tower 2', price_vnd: 27_000_000 });
    listing('l-dear', { title: 'Penthouse 2BR, Empire City', price_vnd: 60_000_000 });
    listing('l-big', { title: '3BR, Empire City', bedrooms: 3 });

    // The sweep, Tuesday 09:00. Window long shut, so it is the template.
    at('2026-10-06T02:00:00Z');
    const week1 = await sweepFor(String(w.renter_id));
    expect(week1.items.map(i => i.listingId)).toEqual(['l-fits']);
    expect(week1.result.sent).toBe(true);
    expect(week1.result.detailed).toBe(false);
    expect(adapter.delivered.at(-1)?.templateParams).toEqual(['there', '1', 'Empire City']);

    // 3. They answer. The places go free-form, with links.
    at('2026-10-06T04:00:00Z');
    const answer = await inbound('yes please');
    expect(answer.action.kind).toBe('ALERT_DETAILS');
    expect(answer.outcome.requestId).toBeUndefined();
    expect(answer.reply).toContain('https://hausto.com/property/l-fits');
    expect(answer.reply).not.toContain('l-dear');

    // A second yes does not resend them.
    at('2026-10-06T04:01:00Z');
    const again = await inbound('great thanks');
    expect(again.action.kind).toBe('NONE');

    // 4. The same sweep again the same week sends nothing new.
    const rerun = await sweepFor(String(w.renter_id));
    expect(rerun.items).toEqual([]);

    // 5. STOP ends the watch.
    at('2026-10-07T00:00:00Z');
    const stop = await inbound('STOP');
    expect(stop.action.kind).toBe('NONE');
    expect(db.tables.complex_watches[0].status).toBe('CANCELLED');
  });

  it('answers a code that is too old, rather than going quiet', async () => {
    at('2026-10-10T00:00:00Z');
    const r = await inbound(`Hi Hausto - alert me about new places at Empire City (${code})`);
    expect(r.action).toEqual({ kind: 'WATCH_PROBLEM', problem: 'EXPIRED' });
    expect(db.tables.complex_watches[0].status).toBe('PENDING');
    expect(r.reply).toContain('expired');
  });

  it('will not hand one renter\'s watch to another phone', async () => {
    await inbound(`alert me (${code})`);
    const other = await inbound(`alert me (${code})`, '+84907654321');
    expect(other.action).toEqual({ kind: 'WATCH_PROBLEM', problem: 'UNKNOWN' });
  });

  it('treats a redelivered code as the same confirmation, answered once', async () => {
    await inbound(`alert me (${code})`);
    const second = await inbound(`alert me (${code})`);
    expect(second.action.kind).toBe('WATCH_CONFIRMED');
    const acks = db.tables.messages.filter(m => String(m.idempotency_key).includes('WATCH_CONFIRMED'));
    expect(acks).toHaveLength(1);
  });

  it('lifts an earlier STOP, because sending the code is the renter opting back in', async () => {
    db.tables.renters.push({ id: 'r-x', phone_e164: PHONE, service_window_expires_at: null, opted_out_at: '2026-09-01T00:00:00Z' });
    const r = await inbound(`alert me (${code})`);
    expect(r.action.kind).toBe('WATCH_CONFIRMED');
    expect(db.tables.renters[0].opted_out_at).toBeNull();
    expect(r.reply).toBeTruthy();
  });

  it('does not let "yes" to an alert confirm a viewing request', async () => {
    const first = await inbound(`alert me (${code})`);
    const renterId = first.outcome.renterId;
    // A request of theirs, delivered and waiting on a yes.
    db.tables.viewing_requests.push({ id: 'req-1', ref: 'HV-4KX9', renter_id: renterId, created_at: '2026-09-27T00:00:00Z' });
    at('2026-10-03T00:00:00Z');
    listing('l-fits', { title: '2BR, Empire City' });
    at('2026-10-06T02:00:00Z');
    await sweepFor(renterId);
    at('2026-10-06T03:00:00Z');
    const yes = await inbound('yes');
    expect(yes.outcome.requestId).toBeUndefined();
    expect(yes.outcome.confirmed).toBe(false);
    expect(db.tables.events.filter(e => e.request_id === 'req-1')).toHaveLength(0);
  });
});
