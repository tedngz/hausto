// A stranger messages the number (2026-10-13): the greeting, a search typed
// as three messages, a follow-up that narrows it, a number picked from the
// results, and the limits - on FakeDb and MockAdapter, through the same
// handleInbound, decideAction, performAction and runSearch the webhook uses.
// Only the model, the search endpoint, chat-ai's credit counter and the clock
// are stand-ins.
//
//   REHEARSAL_PRINT=1 npx vitest run search-rehearsal

import { describe, it, expect, beforeEach } from 'vitest';
import { FakeDb } from './fake-db.ts';
import { MockAdapter } from '../whatsapp/adapter.ts';
import { SupabaseMessageStore } from '../whatsapp/store.ts';
import { handleInbound, type InboundOutcome } from './routing.ts';
import { decideAction, type AgentAction } from './agent.ts';
import { performAction } from './agent-act.ts';
import { runSearch, type ChatMessage, type SearchDeps, type SearchRunResult } from './search-run.ts';
import { FREE_NUMBER_DAILY_SEARCHES, GLOBAL_DAILY_SEARCH_CAP } from './search-limits.ts';
import { FREE_DAILY_AI_CREDITS } from '../ai-credits.ts';
import type { SearchFilters } from './search.ts';

const PHONE = '+84907654321';
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
let clock: number;
let prompts: ChatMessage[][];
let credits: Map<string, number>;
let deps: SearchDeps;

function seed() {
  db = new FakeDb();
  adapter = new MockAdapter();
  // deno-lint-ignore no-explicit-any
  store = new SupabaseMessageStore(db as any);
  clock = Date.now();
  prompts = [];
  credits = new Map();
  // Rows stamped on the test's clock, a millisecond apart: Postgres keeps
  // microseconds, and a burst read in the wrong order is not one we would see.
  const stamp = (row: Record<string, unknown>) => ({ ...row, created_at: new Date(clock++).toISOString() });
  db.onInsert.messages = stamp;
  db.onInsert.renter_searches = stamp;

  [
    { title: 'Sunny 2BR in Thao Dien', district: 'D2', price: 18_000_000 },
    { title: 'Garden 2BR, An Phu', district: 'D2', price: 19_500_000 },
    { title: 'Corner 2BR near the river', district: 'D2', price: 17_000_000 },
    { title: 'Phu My Hung 2BR with pool', district: 'D7', price: 16_000_000 },
  ].forEach((l, i) => db.tables.external_properties.push({
    id: `listing-${i + 1}`, title: l.title, district_code: l.district, price_vnd: l.price,
    is_active: true, bedrooms: 2, area_sqm: 70, price_confidence: 'HIGH',
  }));

  deps = {
    // A model that reads districts the way the real one is asked to, and
    // keeps the earlier filters it is shown.
    extract: (messages) => {
      prompts.push(messages);
      const said = messages[1].content.toLowerCase();
      const earlier = messages[0].content.match(/searched before with these filters: (\{.*\})/);
      const kept: Partial<SearchFilters> = earlier ? JSON.parse(earlier[1]) : {};
      const out: Record<string, unknown> = { ...kept };
      if (said.includes('2br')) out.rooms = '2';
      if (said.includes('thao dien')) out.district = 'thao dien';
      if (said.includes('district 7')) out.district = 'district 7';
      if (said.includes('20tr')) out.max_budget = 20;
      return Promise.resolve(out);
    },
    search: (filters) => Promise.resolve(
      db.tables.external_properties
        .filter(p => (filters.district === 'district 7' ? p.district_code === 'D7' : p.district_code === 'D2'))
        .slice(0, filters.limit)
        .map(p => ({ id: String(p.id), title: String(p.title), url: `https://hausto.com/property/${p.id}` })),
    ),
    credits: {
      spend: (userId) => {
        credits.set(userId, (credits.get(userId) ?? 0) + 1);
        return Promise.resolve(credits.get(userId)!);
      },
      refund: (userId) => {
        credits.set(userId, (credits.get(userId) ?? 1) - 1);
        return Promise.resolve();
      },
    },
    sleep: (ms) => { clock += ms; return Promise.resolve(); },
    now: () => new Date(clock),
    siteUrl: 'https://hausto.com',
  };
}

/** The webhook, for one inbound message: route, decide, act - or dispatch a search. */
async function renterSays(text: string): Promise<{ outcome: InboundOutcome; action: AgentAction }> {
  say('RENTER', text);
  // deno-lint-ignore no-explicit-any
  const outcome = await handleInbound(db as any, store, {
    from: PHONE, text, providerMessageId: `wamid.${Math.random()}`, timestamp: new Date(clock).toISOString(),
  });
  const action = decideAction({
    enabled: true, intent: outcome.intent, text, requestId: outcome.requestId, optedOut: outcome.optedOut,
    confirmed: outcome.confirmed, selection: outcome.selection, watch: outcome.watch,
    alertMessageId: outcome.alertMessageId, inquiryId: outcome.inquiryId, lockIn: outcome.lockIn,
    link: outcome.link, received: outcome.received, searchPick: outcome.searchPick,
    searching: outcome.searching, firstContact: outcome.firstContact,
  });
  if (action.kind !== 'NONE' && action.kind !== 'SEARCH') {
    // deno-lint-ignore no-explicit-any
    await performAction(db as any, adapter, action, {
      renterId: outcome.renterId, requestId: outcome.requestId, providerMessageId: String(outcome.message.id),
    });
    hausto();
  }
  return { outcome, action };
}

/** viewing-agent-search, for one dispatched message. */
async function search(outcome: InboundOutcome): Promise<SearchRunResult> {
  // deno-lint-ignore no-explicit-any
  const r = await runSearch(db as any, adapter, {
    renterId: outcome.renterId, triggerMessageId: String(outcome.message.id), requestId: outcome.requestId,
  }, deps);
  if (r.status === 'SENT' || (r.status === 'REFUSED' && r.messageId)) hausto();
  return r;
}

let shown = 0;
function hausto() {
  const out = db.tables.messages.filter(m => m.direction === 'OUT');
  for (const m of out.slice(shown)) say('HAUSTO', String(m.body));
  shown = out.length;
}

const outbound = () => db.tables.messages.filter(m => m.direction === 'OUT');

describe('a stranger asks on WhatsApp', () => {
  beforeEach(() => { seed(); shown = 0; });

  it('greets, searches the burst once, narrows, and answers a pick with the page', async () => {
    // 1. "hi" - a new number, and not a search: the greeting.
    const hi = await renterSays('hi');
    expect(hi.action.kind).toBe('WELCOME');
    expect(outbound()).toHaveLength(1);
    expect(String(outbound()[0].body)).toContain('Tell us what you are looking for');

    // 2. The brief, typed as three messages. Two read as searches; the burst
    //    is searched once, as one brief.
    const a = await renterSays('looking for 2br');
    const b = await renterSays('thao dien');
    const c = await renterSays('under 20tr');
    expect([a.action.kind, b.action.kind, c.action.kind]).toEqual(['SEARCH', 'NONE', 'SEARCH']);

    const [ra, rc] = await Promise.all([search(a.outcome), search(c.outcome)]);
    const sent = [ra, rc].filter(r => r.status === 'SENT');
    expect(sent).toHaveLength(1);
    expect([ra, rc].find(r => r.status !== 'SENT')?.status).toBe('STOOD_DOWN');
    expect(prompts).toHaveLength(1);
    expect(prompts[0][1].content).toBe('hi\nlooking for 2br\nthao dien\nunder 20tr');

    const results = String(outbound().pop()!.body);
    expect(results).toContain('3 places match');
    expect(results).toContain('https://hausto.com/property/listing-1');
    expect(results).toContain('tap Request viewing');
    expect(results).not.toMatch(/book/i);
    expect(db.tables.renter_searches).toHaveLength(1);
    expect(db.tables.renter_searches[0].counted).toBe(true);

    // 3. "What about district 7?" - a question, read as a new search because
    //    results just went out. The model is shown the earlier filters.
    const d7 = await renterSays('what about district 7?');
    expect(d7.outcome.searching).toBe(true);
    expect(d7.action.kind).toBe('SEARCH');
    expect((await search(d7.outcome)).status).toBe('SENT');
    expect(prompts[1][0].content).toContain('"rooms":"2"');
    expect(String(outbound().pop()!.body)).toContain('Phu My Hung 2BR');

    // 4. "1" - picked from those results. The page, not a request.
    const pick = await renterSays('1');
    expect(pick.action).toEqual({ kind: 'SEARCH_PICK', listingIds: ['listing-4'] });
    const reply = String(outbound().pop()!.body);
    expect(reply).toContain('https://hausto.com/property/listing-4');
    expect(reply).toContain('tap Request viewing');
    expect(db.tables.viewing_requests).toHaveLength(0);

    // 5. "is there parking?" - a question about a place: a person's, still.
    expect((await renterSays('is there parking?')).action.kind).toBe('NONE');
  });

  it('asks for more when the message names nothing to search on', async () => {
    const q = await renterSays('do you have any apartments?');
    expect(q.action.kind).toBe('SEARCH');
    expect((await search(q.outcome)).status).toBe('SENT');
    expect(String(outbound().pop()!.body)).toContain('tell us a little more');
  });

  it(`stops a number with no account at ${FREE_NUMBER_DAILY_SEARCHES} a day, and says so once`, async () => {
    const statuses: string[] = [];
    for (let i = 0; i < FREE_NUMBER_DAILY_SEARCHES + 2; i++) {
      const m = await renterSays(`looking for 2br thao dien, try ${i}`);
      statuses.push((await search(m.outcome)).status);
    }
    expect(statuses).toEqual([...Array(FREE_NUMBER_DAILY_SEARCHES).fill('SENT'), 'REFUSED', 'REFUSED']);
    const refusals = outbound().filter(m => String(m.idempotency_key).includes('AGENT_SEARCH_LIMIT'));
    expect(refusals).toHaveLength(1);
    expect(String(refusals[0].body)).toContain(`today's ${FREE_NUMBER_DAILY_SEARCHES} free searches`);
    // Refusals cost nothing: no model call, not counted.
    expect(prompts).toHaveLength(FREE_NUMBER_DAILY_SEARCHES);
    expect(db.tables.renter_searches.filter(s => s.counted)).toHaveLength(FREE_NUMBER_DAILY_SEARCHES);
  });

  it('spends a linked account from the web chat allowance', async () => {
    const first = await renterSays('looking for 2br thao dien');
    db.tables.renters[0].user_id = 'user-1';
    credits.set('user-1', FREE_DAILY_AI_CREDITS);
    const r = await search(first.outcome);
    expect(r.status === 'REFUSED' && r.reason).toBe('ACCOUNT_CREDITS');
    // Refunded: a refused search spends nothing.
    expect(credits.get('user-1')).toBe(FREE_DAILY_AI_CREDITS);
    expect(String(outbound().pop()!.body)).toContain('free AI credits');
  });

  it('goes quiet past the daily cap for every number together', async () => {
    for (let i = 0; i < GLOBAL_DAILY_SEARCH_CAP; i++) {
      (db.tables.renter_searches ??= []).push({ id: `old-${i}`, renter_id: 'someone-else', counted: true, created_at: new Date().toISOString() });
    }
    const m = await renterSays('looking for 2br thao dien');
    const before = outbound().length;
    const r = await search(m.outcome);
    expect(r.status === 'REFUSED' && r.reason).toBe('GLOBAL_CAP');
    expect(outbound()).toHaveLength(before);
    expect(prompts).toHaveLength(0);
  });

  it('un-counts a search the model failed on', async () => {
    deps.extract = () => Promise.reject(new Error('budget_exhausted'));
    const m = await renterSays('looking for 2br thao dien');
    expect((await search(m.outcome)).status).toBe('FAILED');
    expect(db.tables.renter_searches[0].counted).toBe(false);
  });
});
