// The availability request on WhatsApp, end to end, printed (SPEC §11).
//
// The FakeDb, the MockAdapter and the real handleInbound / decideAction /
// performAction / sendConciergeWhatsApp / sendAlert, so the words below are
// the words a renter gets. Silent unless:
//
//   REHEARSAL_PRINT=1 npx vitest run rehearsal

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FakeDb } from './fake-db.ts';
import { MockAdapter } from '../whatsapp/adapter.ts';
import { SupabaseMessageStore } from '../whatsapp/store.ts';
import { ServiceWindowClosedError } from '../whatsapp/send.ts';
import { handleInbound } from './routing.ts';
import { decideAction } from './agent.ts';
import { performAction } from './agent-act.ts';
import { recordInquiryMessage, sendConciergeWhatsApp } from './concierge.ts';
import { sendAlert } from './alerts.ts';
import { buildInquiryLink } from './inquiry.ts';
import { generateWatchCode, watchExpiry } from './watch.ts';

const PHONE = '+84901234567';
const BUSINESS = '+84901112222';
const PRINT = process.env.REHEARSAL_PRINT === '1';

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

const at = (iso: string) => vi.setSystemTime(new Date(iso));
const inquiry = () => db.tables.complex_inquiries[0];
const thread = () => db.tables.complex_inquiry_messages ?? [];

function seed() {
  db = new FakeDb();
  adapter = new MockAdapter();
  // deno-lint-ignore no-explicit-any
  store = new SupabaseMessageStore(db as any);
  db.tables.complexes = [{ id: 'cx-1', name: 'Empire City' }];
  code = generateWatchCode();
  const now = new Date();
  // What complex-inquiry-create writes for a WhatsApp request.
  db.tables.complex_watches = [{
    id: 'watch-1', complex_id: 'cx-1', code, user_id: null, renter_id: null,
    bedrooms: 2, budget_max_vnd: 25_000_000, move_in_by: '2026-11-15', status: 'PENDING',
    confirmed_at: null, expires_at: watchExpiry(now, '2026-11-15').toISOString(), created_at: now.toISOString(),
  }];
  db.tables.complex_inquiries = [{
    id: 'inq-1', complex_id: 'cx-1', full_name: 'Mai Nguyen', email: null, phone: null,
    target_move_in_date: '2026-11-15', lease_duration_months: 12, bedrooms_needed: 2,
    budget_max_vnd: 25_000_000, has_pets: true, additional_notes: 'High floor', status: 'new',
    channel: 'WHATSAPP', watch_id: 'watch-1', renter_id: null, whatsapp_confirmed_at: null,
    last_inbound_at: null, last_message_at: null, created_at: now.toISOString(),
  }];
}

async function inbound(text: string) {
  say('Renter', text);
  // deno-lint-ignore no-explicit-any
  const outcome = await handleInbound(db as any, store, {
    from: PHONE, text, providerMessageId: `wamid.${Math.random()}`, timestamp: new Date().toISOString(),
  });
  const action = decideAction({
    enabled: false, intent: outcome.intent, text, requestId: outcome.requestId,
    optedOut: outcome.optedOut, confirmed: outcome.confirmed, selection: outcome.selection,
    watch: outcome.watch, alertMessageId: outcome.alertMessageId, inquiryId: outcome.inquiryId,
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

/** What the dashboard's "Send on WhatsApp" does (concierge-email-reply). */
async function concierge(body: string) {
  // deno-lint-ignore no-explicit-any
  const sent = await sendConciergeWhatsApp(db as any, store, adapter, { inquiryId: 'inq-1', body, key: String(Math.random()) });
  // deno-lint-ignore no-explicit-any
  await recordInquiryMessage(db as any, {
    inquiryId: 'inq-1', direction: 'outbound', source: 'dashboard', whatsappMessageId: sent.messageId, body, now: new Date(),
  });
  say('Hausto  [the concierge, from Admin Tools]', body);
  return sent;
}

describe('availability request rehearsal', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-09-29T03:00:00Z');
    seed();
  });
  afterEach(() => vi.useRealTimers());

  it('plays the whole thing: code, confirmation, the concierge, their reply, a later alert', async () => {
    if (PRINT) console.log('\n\n══ REHEARSAL - availability request, Empire City ══');
    const link = buildInquiryLink(BUSINESS, code, 'Empire City');
    if (PRINT) console.log(`\n  The link at the end of the form:\n  ${link}`);

    // 1. The code. The request is confirmed and the concierge's clock starts.
    at('2026-09-29T03:02:00Z');
    const first = await inbound(decodeURIComponent(link.split('?text=')[1]));
    expect(first.action.kind).toBe('WATCH_CONFIRMED');
    expect(first.outcome.watch?.kind === 'CONFIRMED' && first.outcome.watch.inquiry?.firstConfirm).toBe(true);
    expect(first.reply).toContain('Thanks Mai');
    expect(first.reply).toContain('within 24 hours');
    expect(inquiry().whatsapp_confirmed_at).toBe('2026-09-29T03:02:00.000Z');
    expect(inquiry().phone).toBe(PHONE);
    expect(inquiry().renter_id).toBe(first.outcome.renterId);
    // The thread opens with their message and our confirmation.
    expect(thread().map(t => `${t.direction}:${t.source}`)).toEqual(['inbound:whatsapp', 'outbound:system']);
    expect(db.tables.complex_watches[0].status).toBe('ACTIVE');

    // 2. The concierge answers, a few hours later, inside the window.
    at('2026-09-29T09:30:00Z');
    await concierge(
      'Hi Mai - two 2BRs are free at Empire City from mid-November:\n' +
      '1. Tower Linden, 18th floor, 24.000.000 ₫, pets OK\n' +
      '2. Tower Cove, 9th floor, 22.500.000 ₫, no pets\n' +
      'Want me to arrange a viewing of the first one?',
    );
    expect(inquiry().status).toBe('new'); // the dashboard function moves it; this is the shared half

    // 3. Their reply lands on the request, and nothing automated answers it.
    at('2026-09-29T10:00:00Z');
    const reply = await inbound('Yes please, Saturday morning works');
    expect(reply.outcome.inquiryId).toBe('inq-1');
    expect(reply.outcome.requestId).toBeUndefined();
    expect(reply.action.kind).toBe('NONE');
    expect(thread().at(-1)?.body).toBe('Yes please, Saturday morning works');
    expect(inquiry().last_inbound_at).toBe('2026-09-29T10:00:00.000Z');

    // 4. A week on, a new listing at the building: the watch the request set up.
    at('2026-10-03T00:00:00Z');
    db.tables.external_properties.push({
      id: 'l-new', is_active: true, price_vnd: 23_000_000, price_confidence: 'HIGH', bedrooms: 2,
      area_sqm: 80, district_code: 'HCM-D2', realtor_id: null, title: '2BR, Empire City Tilia',
      created_at: new Date().toISOString(),
    });
    at('2026-10-06T02:00:00Z');
    const alert = await sendAlert(db as never, store, adapter, {
      renterId: String(inquiry().renter_id), renterName: 'Mai', now: new Date(),
      items: [{ listingId: 'l-new', title: '2BR, Empire City Tilia', priceVnd: 23_000_000, bedrooms: 2, source: 'WATCH', watchId: 'watch-1', label: 'Empire City' }],
    });
    expect(alert.sent).toBe(true);
    say('Hausto  [template weekly_digest]', 'Hi Mai, there are 1 new places this week in Empire City. Reply here if you would like to see them.');

    // 5. Their reply to the alert is about the alert, not the request.
    at('2026-10-06T03:00:00Z');
    const toAlert = await inbound('show me');
    expect(toAlert.action.kind).toBe('ALERT_DETAILS');
    expect(toAlert.outcome.inquiryId).toBeUndefined();
  });

  it('cannot reach WhatsApp once the window has shut - the concierge is told, not silently dropped', async () => {
    await inbound(`Hi Hausto - please check availability at Empire City for me (${code})`);
    at('2026-09-30T04:00:00Z'); // 25 hours on
    await expect(
      // deno-lint-ignore no-explicit-any
      sendConciergeWhatsApp(db as any, store, adapter, { inquiryId: 'inq-1', body: 'Found one!', key: 'k' }),
    ).rejects.toBeInstanceOf(ServiceWindowClosedError);
  });

  it('refuses to send for a request whose code never arrived', async () => {
    await expect(
      // deno-lint-ignore no-explicit-any
      sendConciergeWhatsApp(db as any, store, adapter, { inquiryId: 'inq-1', body: 'Hello?', key: 'k' }),
    ).rejects.toThrow(/not been confirmed/);
  });

  it('does not let a reply to the concierge confirm a viewing itinerary', async () => {
    const first = await inbound(`(${code})`);
    db.tables.viewing_requests.push({ id: 'req-1', ref: 'HV-4KX9', renter_id: first.outcome.renterId, created_at: '2026-09-27T00:00:00Z' });
    at('2026-09-29T05:00:00Z');
    await concierge('Two are free - want to see them?');
    at('2026-09-29T06:00:00Z');
    const yes = await inbound('yes');
    expect(yes.outcome.inquiryId).toBe('inq-1');
    expect(yes.outcome.requestId).toBeUndefined();
    expect(db.tables.events.filter(e => e.request_id === 'req-1')).toHaveLength(0);
  });

  it('files a redelivered code once, and confirms the request once', async () => {
    await inbound(`(${code})`);
    const again = await inbound(`(${code})`);
    expect(again.outcome.watch?.kind === 'CONFIRMED' && again.outcome.watch.inquiry?.firstConfirm).toBe(false);
    expect(thread()).toHaveLength(2);
  });
});
