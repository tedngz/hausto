// Stage 2 end to end on the in-memory database: a renter reply the AI
// operator sends itself, and every way that is stopped.

import { describe, it, expect, beforeEach } from 'vitest';
import { FakeDb } from './fake-db.ts';
import { MockAdapter } from '../whatsapp/adapter.ts';
import { SupabaseMessageStore } from '../whatsapp/store.ts';
import { ManualChannel } from '../realtor/channel.ts';
import { SupabaseRealtorMessageStore } from '../realtor/store.ts';
import { performOpsAction, type OpsDeps } from './ops-actions.ts';
import { runPlanner, loadAutonomyState } from './plan-run.ts';
import { AUTO_HOLD_MS, GATE } from './autonomy.ts';

let db: FakeDb;
let deps: OpsDeps;
let whatsapp: MockAdapter;
const T0 = Date.now();
const at = (ms: number) => new Date(T0 + ms);

// deno-lint-ignore no-explicit-any
const act = (input: Record<string, unknown>) => performOpsAction(db as any, deps, 'OPS:op-1', input);
const reply = () => (db.tables.operator_proposals ?? []).find(p => p.dedupe_key === 'RENTER:in-1')!;

async function pass(now: Date, env = 'REPLY') {
  // deno-lint-ignore no-explicit-any
  const state = await loadAutonomyState(db as any, env, now);
  // deno-lint-ignore no-explicit-any
  return runPlanner(db as any, {
    now,
    parse: () => Promise.resolve(null),
    draft: () => Promise.resolve({ kind: 'DRAFT', message: 'Yes - pets are allowed there. Ref HV-4KX9', confidence: 'HIGH', needsAgent: false, note: '' }),
    autonomy: { state, deps },
  });
}

/** A stage 1 record on REPLY, as operators left it. */
function record(decided: number, agreed: number) {
  for (let i = 0; i < decided; i++) {
    db.tables.operator_proposals.push({
      id: `hist-${i}`, request_id: 'old', item_id: null, dedupe_key: `RENTER:old-${i}`, action: 'REPLY',
      input: {}, status: i < agreed ? 'APPROVED' : 'CORRECTED', edited: false, decided_at: new Date(T0 - 86_400_000).toISOString(),
    });
  }
}

beforeEach(() => {
  db = new FakeDb();
  whatsapp = new MockAdapter();
  deps = {
    whatsapp,
    // deno-lint-ignore no-explicit-any
    messages: new SupabaseMessageStore(db as any),
    realtorChannel: new ManualChannel(),
    // deno-lint-ignore no-explicit-any
    realtorMessages: new SupabaseRealtorMessageStore(db as any),
  };
  db.tables.operator_proposals = [];
  db.tables.ai_operator_controls = [{ id: 'singleton', paused: false }];
  db.tables.renters.push({ id: 'renter-1', phone_e164: '+84912345678', display_name: null,
    service_window_expires_at: at(6 * 3600_000).toISOString(), opted_out_at: null });
  db.tables.viewing_requests.push({ id: 'req-1', ref: 'HV-4KX9', renter_id: 'renter-1', created_at: at(-3600_000).toISOString(), availability: [] });
  db.tables.external_properties.push({ id: 'l1', title: 'Sunny 2BR', district_code: 'D2' });
  db.tables.request_items.push({ id: 'i1', request_id: 'req-1', listing_id: 'l1', realtor_id: null, price_vnd_at_request: 15_000_000 });
  db.tables.messages.push({ id: 'in-1', request_id: 'req-1', direction: 'IN', to_phone: '+84912345678',
    body: 'Are pets allowed?', status: 'QUEUED', idempotency_key: 'inbound:w1', created_at: at(-60_000).toISOString() });
  db.tables.events.push(
    { id: 'e1', request_id: 'req-1', item_id: null, type: 'REQUEST_SUBMITTED', payload: {}, actor: 'RENTER', occurred_at: at(-3600_000).toISOString() },
    { id: 'e2', request_id: 'req-1', item_id: 'i1', type: 'ITEM_ADDED', payload: {}, actor: 'RENTER', occurred_at: at(-3600_000).toISOString() },
    { id: 'e3', request_id: 'req-1', item_id: null, type: 'RENTER_REPLIED', payload: { intent: 'QUESTION', message_id: 'in-1' }, actor: 'RENTER', occurred_at: at(-60_000).toISOString() },
  );
});

describe('with every lock open', () => {
  beforeEach(() => record(GATE.minDecided, GATE.minDecided));

  it('waits out the hold, then sends the reply itself, as the AI operator', async () => {
    await pass(at(0));
    expect(reply()).toMatchObject({ action: 'REPLY', status: 'PENDING', execute_after: at(AUTO_HOLD_MS).toISOString() });
    expect(whatsapp.delivered).toHaveLength(0);

    await pass(at(AUTO_HOLD_MS - 1000));
    expect(whatsapp.delivered).toHaveLength(0);

    const r = await pass(at(AUTO_HOLD_MS + 1000));
    expect(r.executed).toBe(1);
    expect(whatsapp.delivered.map(d => d.body)).toEqual(['Yes - pets are allowed there. Ref HV-4KX9']);
    expect(db.tables.events.find(e => e.type === 'REPLY_SENT')!.actor).toBe('AGENT:auto-v1');
    expect(reply().status).toBe('EXECUTED');
  });

  it('never sends twice', async () => {
    await pass(at(0));
    await pass(at(AUTO_HOLD_MS + 1000));
    await pass(at(AUTO_HOLD_MS + 2000));
    expect(whatsapp.delivered).toHaveLength(1);
  });

  it('stops when an operator holds it, and waits for them instead', async () => {
    await pass(at(0));
    await act({ action: 'HOLD_PROPOSAL', proposalId: reply().id });
    await pass(at(AUTO_HOLD_MS + 1000));
    expect(whatsapp.delivered).toHaveLength(0);
    expect(reply()).toMatchObject({ status: 'PENDING', execute_after: null });
  });

  it('stops when an operator pauses everything, even mid-hold', async () => {
    await pass(at(0));
    await act({ action: 'SET_AUTONOMY', paused: true });
    await pass(at(AUTO_HOLD_MS + 1000));
    expect(whatsapp.delivered).toHaveLength(0);
    expect(db.tables.ai_operator_controls[0].last_state).toMatchObject({ paused: true });
  });

  it('hands it to a person when the send is refused at run time', async () => {
    await pass(at(0));
    db.tables.renters[0].service_window_expires_at = at(-1000).toISOString();
    await pass(at(AUTO_HOLD_MS + 1000));
    expect(whatsapp.delivered).toHaveLength(0);
    expect(reply()).toMatchObject({ status: 'PENDING', execute_after: null });
    expect(String(reply().decision_note)).toMatch(/Handed to a person/);
  });

  it('can be flagged as wrong afterwards - which is not a shadow decision', async () => {
    await pass(at(0));
    await pass(at(AUTO_HOLD_MS + 1000));
    expect((await act({ action: 'FLAG_PROPOSAL', proposalId: reply().id, note: 'that flat does not allow dogs' })).status).toBe(200);
    expect(reply()).toMatchObject({ status: 'FLAGGED', decision_note: 'that flat does not allow dogs' });
    // deno-lint-ignore no-explicit-any
    const state = await loadAutonomyState(db as any, 'REPLY', at(AUTO_HOLD_MS + 2000));
    expect(state.actions.REPLY.reason).toMatch(/30 decisions/);
  });
});

describe('with a lock shut', () => {
  it('runs as shadow mode exactly when the env does not list it', async () => {
    record(GATE.minDecided, GATE.minDecided);
    await pass(at(0), '');
    await pass(at(AUTO_HOLD_MS + 1000), '');
    expect(reply()).toMatchObject({ status: 'PENDING', execute_after: null });
    expect(whatsapp.delivered).toHaveLength(0);
  });

  it('runs as shadow mode exactly while the record is short of the bar', async () => {
    record(GATE.minDecided, GATE.minDecided - 4); // 26 of 30: 87%
    await pass(at(0));
    await pass(at(AUTO_HOLD_MS + 1000));
    expect(reply().execute_after).toBeNull();
    expect(whatsapp.delivered).toHaveLength(0);
  });
});

describe('with the gate skipped by override', () => {
  it('sends with no shadow record at all, once the hold is out', async () => {
    db.tables.ai_operator_controls[0].gate_override = ['REPLY'];
    await pass(at(0));
    expect(reply().execute_after).toBe(at(AUTO_HOLD_MS).toISOString());
    await pass(at(AUTO_HOLD_MS + 1000));
    expect(whatsapp.delivered).toHaveLength(1);
    expect(db.tables.ai_operator_controls[0].last_state.actions.REPLY.reason).toMatch(/Gate skipped by override/);
  });

  it('can be restored from the console, and only names known actions', async () => {
    db.tables.ai_operator_controls[0].gate_override = ['REPLY'];
    expect((await act({ action: 'SET_AUTONOMY', gateOverride: ['EVERYTHING'] })).status).toBe(400);
    expect((await act({ action: 'SET_AUTONOMY', gateOverride: [] })).status).toBe(200);
    await pass(at(0));
    expect(reply().execute_after).toBeNull();
  });
});

describe('stage 3: an agent reply recorded without a person', () => {
  it('reads the reply, holds, then records the outcome as the AI operator', async () => {
    db.tables.realtors = [{ id: 'realtor-1', phone_e164: '+84901234567' }];
    db.tables.request_items[0].realtor_id = 'realtor-1';
    // The renter's question is answered already, so only the broker side is in play.
    db.tables.events.push({ id: 'e4', request_id: 'req-1', item_id: null, type: 'REPLIES_ACKNOWLEDGED', payload: {}, actor: 'OPS:op-1', occurred_at: at(-30_000).toISOString() });
    await act({ action: 'CONTACTED', itemId: 'i1', message: 'Chào anh' });
    await act({ action: 'REALTOR_REPLY', itemId: 'i1', message: 'Căn này cho thuê rồi em nhé' });
    for (let i = 0; i < GATE.minDecided; i++) {
      db.tables.operator_proposals.push({ id: `o-${i}`, request_id: 'old', item_id: null, dedupe_key: `OUTCOME:old:${i}`,
        action: 'OUTCOME', input: {}, status: 'AGREED', edited: false, decided_at: at(-86_400_000).toISOString() });
    }

    const outcomePass = async (now: Date) => {
      // deno-lint-ignore no-explicit-any
      const state = await loadAutonomyState(db as any, 'OUTCOME', now);
      // deno-lint-ignore no-explicit-any
      return runPlanner(db as any, {
        now,
        parse: () => Promise.resolve({ outcome: 'ALREADY_RENTED', slots: [], actualPriceVnd: null,
          note: 'The agent says it is rented.', confidence: 'HIGH', problems: [], model: 'gpt-4o-mini' }),
        autonomy: { state, deps },
      });
    };

    await outcomePass(at(0));
    const p = db.tables.operator_proposals.find(x => String(x.dedupe_key).startsWith('OUTCOME:i1:'))!;
    expect(p).toMatchObject({ action: 'OUTCOME', status: 'PENDING', execute_after: at(AUTO_HOLD_MS).toISOString() });

    await outcomePass(at(AUTO_HOLD_MS + 1000));
    const recorded = db.tables.events.find(e => e.type === 'OUTCOME_RECORDED')!;
    expect(recorded).toMatchObject({ actor: 'AGENT:auto-v1', payload: { outcome: 'ALREADY_RENTED' } });
    expect(p.status).toBe('EXECUTED');
  });
});

describe('stage 4: an agent asked without a person', () => {
  it('queues the first message for the Zalo device, and "contacted" waits for the device', async () => {
    const { BridgeChannel } = await import('../realtor/channel.ts');
    deps.realtorChannel = new BridgeChannel();
    db.tables.realtors = [{ id: 'realtor-1', phone_e164: '+84901234567' }];
    db.tables.request_items[0].realtor_id = 'realtor-1';
    db.tables.events.push({ id: 'e4', request_id: 'req-1', item_id: null, type: 'REPLIES_ACKNOWLEDGED', payload: {}, actor: 'OPS:op-1', occurred_at: at(-30_000).toISOString() });
    for (let i = 0; i < GATE.minDecided; i++) {
      db.tables.operator_proposals.push({ id: `c-${i}`, request_id: 'old', item_id: null, dedupe_key: `CONTACT:old-${i}`,
        action: 'CONTACTED', input: {}, status: 'APPROVED', edited: false, decided_at: at(-86_400_000).toISOString() });
    }
    const contactPass = async (now: Date, channel: string) => {
      // deno-lint-ignore no-explicit-any
      const state = await loadAutonomyState(db as any, 'CONTACTED', now, { realtorChannel: channel });
      // deno-lint-ignore no-explicit-any
      return runPlanner(db as any, { now, parse: () => Promise.resolve(null), autonomy: { state, deps } });
    };

    await contactPass(at(0), 'bridge');
    const p = db.tables.operator_proposals.find(x => x.dedupe_key === 'CONTACT:i1')!;
    expect(p.execute_after).toBe(at(AUTO_HOLD_MS).toISOString());

    await contactPass(at(AUTO_HOLD_MS + 1000), 'bridge');
    expect(p.status).toBe('EXECUTED');
    const queued = db.tables.realtor_messages.find(m => m.direction === 'OUT')!;
    expect(queued).toMatchObject({ status: 'QUEUED', purpose: 'REQUEST_VIEWING', actor: 'AGENT:auto-v1' });
    expect(queued.on_sent_event).toMatchObject({ type: 'REALTOR_CONTACTED', actor: 'AGENT:auto-v1' });
    expect(db.tables.events.filter(e => e.type === 'REALTOR_CONTACTED')).toHaveLength(0);
  });

  it('proposes it for a person instead when agent messages go by hand', async () => {
    db.tables.realtors = [{ id: 'realtor-1', phone_e164: '+84901234567' }];
    db.tables.request_items[0].realtor_id = 'realtor-1';
    for (let i = 0; i < GATE.minDecided; i++) {
      db.tables.operator_proposals.push({ id: `c-${i}`, request_id: 'old', item_id: null, dedupe_key: `CONTACT:old-${i}`,
        action: 'CONTACTED', input: {}, status: 'APPROVED', edited: false, decided_at: at(-86_400_000).toISOString() });
    }
    // deno-lint-ignore no-explicit-any
    const state = await loadAutonomyState(db as any, 'CONTACTED', at(0), { realtorChannel: 'manual' });
    // deno-lint-ignore no-explicit-any
    await runPlanner(db as any, { now: at(0), parse: () => Promise.resolve(null), autonomy: { state, deps } });
    expect(db.tables.operator_proposals.find(x => x.dedupe_key === 'CONTACT:i1')!.execute_after).toBeNull();
  });
});
