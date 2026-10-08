// Shadow mode end to end, on the in-memory database: the planner proposes,
// operators decide, and every decision is scored.
//
// The property that matters most is the one stage 1 exists to hold: the AI
// operator never writes to the log. Every event here is written by an operator
// approving or doing the work, under OPS:<uuid>.

import { describe, it, expect, beforeEach } from 'vitest';
import { FakeDb } from './fake-db.ts';
import { MockAdapter } from '../whatsapp/adapter.ts';
import { SupabaseMessageStore } from '../whatsapp/store.ts';
import { ManualChannel } from '../realtor/channel.ts';
import { SupabaseRealtorMessageStore } from '../realtor/store.ts';
import { performOpsAction, type OpsDeps } from './ops-actions.ts';
import { runPlanner } from './plan-run.ts';
import type { ParseSuggestion } from './parse-reply.ts';

const ACTOR = 'OPS:op-1';
let db: FakeDb;
let deps: OpsDeps;
let parses = 0;

// deno-lint-ignore no-explicit-any
const act = (input: Record<string, unknown>) => performOpsAction(db as any, deps, ACTOR, input);
const proposals = () => db.tables.operator_proposals ?? [];
const byKey = (key: string) => proposals().find(p => p.dedupe_key === key)!;

const suggestion: ParseSuggestion = {
  outcome: 'CONFIRMED', slots: [{ startsAt: '2026-09-29T02:00:00.000Z', durationMinutes: 30 }],
  actualPriceVnd: null, note: 'Tuesday 9:00 works', confidence: 'HIGH', problems: [], model: 'gpt-4o-mini',
};

const plan = (now = new Date('2026-09-27T02:00:00Z')) =>
  // deno-lint-ignore no-explicit-any
  runPlanner(db as any, { now, parse: () => { parses += 1; return Promise.resolve(suggestion); } });

beforeEach(() => {
  db = new FakeDb();
  parses = 0;
  deps = {
    whatsapp: new MockAdapter(),
    // deno-lint-ignore no-explicit-any
    messages: new SupabaseMessageStore(db as any),
    realtorChannel: new ManualChannel(),
    // deno-lint-ignore no-explicit-any
    realtorMessages: new SupabaseRealtorMessageStore(db as any),
    newKey: () => crypto.randomUUID(),
  };
  db.tables.renters.push({ id: 'renter-1', phone_e164: '+84912345678', display_name: null,
    service_window_expires_at: new Date(Date.now() + 3600_000).toISOString(), opted_out_at: null });
  db.tables.viewing_requests.push({
    id: 'req-1', ref: 'HV-4KX9', renter_id: 'renter-1', created_at: '2026-09-27T00:00:00Z',
    availability: [{ date: '2026-09-29', part: 'MORNING' }],
  });
  db.tables.realtors = [{ id: 'realtor-1', phone_e164: '+84901234567' }];
  db.tables.external_properties.push(
    { id: 'l1', title: 'Căn hộ Thảo Điền', source_url: 'https://example.com/l1', district_code: 'D2' },
    { id: 'l2', title: 'Studio Quận 1', source_url: null, district_code: 'D1' },
  );
  db.tables.request_items.push(
    { id: 'i1', request_id: 'req-1', listing_id: 'l1', realtor_id: 'realtor-1', price_vnd_at_request: 15_000_000 },
    { id: 'i2', request_id: 'req-1', listing_id: 'l2', realtor_id: null, price_vnd_at_request: 9_000_000 },
  );
  db.tables.events.push(
    { id: 'e1', request_id: 'req-1', item_id: null, type: 'REQUEST_SUBMITTED', payload: {}, actor: 'RENTER', occurred_at: '2026-09-27T00:00:00Z' },
    { id: 'e2', request_id: 'req-1', item_id: 'i1', type: 'ITEM_ADDED', payload: {}, actor: 'RENTER', occurred_at: '2026-09-27T00:00:00Z' },
    { id: 'e3', request_id: 'req-1', item_id: 'i2', type: 'ITEM_ADDED', payload: {}, actor: 'RENTER', occurred_at: '2026-09-27T00:00:00Z' },
  );
});

describe('shadow mode', () => {
  it('proposes, and writes nothing to the log itself', async () => {
    const eventsBefore = db.tables.events.length;
    const r = await plan();
    expect(r).toMatchObject({ scanned: 1, proposed: 2 });
    expect(proposals().map(p => [p.dedupe_key, p.action, p.status])).toEqual([
      ['CONTACT:i1', 'CONTACTED', 'PENDING'],
      ['NO_CONTACT:i2', 'ESCALATE', 'PENDING'],
    ]);
    expect(proposals()[0].agent_version).toBe('shadow-v1');
    expect(db.tables.events).toHaveLength(eventsBefore);
  });

  it('does not propose the same thing twice across passes', async () => {
    await plan();
    const second = await plan();
    expect(second.proposed).toBe(0);
    expect(proposals()).toHaveLength(2);
  });

  it('runs an approved proposal as the operator, keeping their edits', async () => {
    await plan();
    const p = byKey('CONTACT:i1');
    const r = await act({ action: 'APPROVE_PROPOSAL', proposalId: p.id, overrides: { message: 'Chào chị, căn còn không ạ?' } });
    expect(r.status).toBe(200);

    const contacted = db.tables.events.find(e => e.type === 'REALTOR_CONTACTED')!;
    expect(contacted.actor).toBe(ACTOR);
    expect(db.tables.realtor_messages[0].body).toBe('Chào chị, căn còn không ạ?');
    expect(byKey('CONTACT:i1')).toMatchObject({ status: 'APPROVED', edited: true, decided_by: 'op-1' });
  });

  it('scores work done by hand against what was proposed', async () => {
    await plan();
    // The operator finds the missing number - what the escalation asked for.
    await act({ action: 'RECORD_CONTACT', itemId: 'i2', phone: '0987654321' });
    expect(byKey('NO_CONTACT:i2').status).toBe('AGREED');
    // And contacts i1 themselves rather than pressing approve.
    await act({ action: 'CONTACTED', itemId: 'i1', message: 'Chào anh' });
    expect(byKey('CONTACT:i1')).toMatchObject({ status: 'AGREED', executed_action: 'CONTACTED' });
  });

  it('does not make a rejected proposal again', async () => {
    await plan();
    await act({ action: 'REJECT_PROPOSAL', proposalId: byKey('CONTACT:i1').id, note: 'agent is on holiday' });
    await plan();
    expect(byKey('CONTACT:i1')).toMatchObject({ status: 'REJECTED', decision_note: 'agent is on holiday' });
    expect(proposals().filter(p => p.dedupe_key === 'CONTACT:i1')).toHaveLength(1);
  });

  it('supersedes a proposal the request has moved past', async () => {
    await plan();
    // Contacted outside the console's flow - say, a direct event from an older client.
    db.tables.events.push({ id: 'e9', request_id: 'req-1', item_id: 'i1', type: 'REALTOR_CONTACTED',
      payload: {}, actor: ACTOR, occurred_at: '2026-09-27T01:00:00Z' });
    const r = await plan();
    expect(r.superseded).toBe(1);
    expect(byKey('CONTACT:i1').status).toBe('SUPERSEDED');
  });

  it('reads an agent reply once, proposes the outcome, and records what it suggested on approval', async () => {
    await act({ action: 'CONTACTED', itemId: 'i1', message: 'Chào anh' });
    await act({ action: 'REALTOR_REPLY', itemId: 'i1', message: 'Thứ 3 9h được em' });
    await plan();
    await plan();
    expect(parses).toBe(1);

    const reply = db.tables.realtor_messages.find(m => m.direction === 'IN')!;
    const p = byKey(`OUTCOME:i1:${reply.id}`);
    expect(p).toMatchObject({ action: 'OUTCOME', status: 'PENDING' });

    expect((await act({ action: 'APPROVE_PROPOSAL', proposalId: p.id })).status).toBe(200);
    const outcome = db.tables.events.find(e => e.type === 'OUTCOME_RECORDED')!;
    expect(outcome.actor).toBe(ACTOR);
    expect(outcome.payload).toMatchObject({ outcome: 'CONFIRMED', suggested: { outcome: 'CONFIRMED', model: 'gpt-4o-mini' } });
    expect(byKey(`OUTCOME:i1:${reply.id}`).status).toBe('APPROVED');
  });

  it('calls it a correction when the operator changes the outcome on approval', async () => {
    await act({ action: 'CONTACTED', itemId: 'i1', message: 'Chào anh' });
    await act({ action: 'REALTOR_REPLY', itemId: 'i1', message: 'Thứ 7 thì được em' });
    await plan();
    const p = proposals().find(x => x.action === 'OUTCOME')!;
    await act({
      action: 'APPROVE_PROPOSAL', proposalId: p.id,
      overrides: { outcome: 'ALTERNATIVE_OFFERED', slots: [{ startsAt: '2026-10-03T03:00:00.000Z', durationMinutes: 30 }] },
    });
    expect(proposals().find(x => x.id === p.id)!.status).toBe('CORRECTED');
  });

  it('refuses to decide the same proposal twice', async () => {
    await plan();
    const id = byKey('CONTACT:i1').id;
    await act({ action: 'REJECT_PROPOSAL', proposalId: id });
    expect((await act({ action: 'APPROVE_PROPOSAL', proposalId: id })).status).toBe(409);
  });
});

describe('a time that clashes', () => {
  const tick = () => new Promise(r => setTimeout(r, 5));

  it('asks the agent for another time, then reads their next answer afresh', async () => {
    db.tables.realtors.push({ id: 'realtor-2', phone_e164: '+84907654321' });
    db.tables.request_items[1].realtor_id = 'realtor-2';
    await act({ action: 'CONTACTED', itemId: 'i1', message: 'Chào anh' });
    await act({ action: 'CONTACTED', itemId: 'i2', message: 'Chào chị' });
    // Căn hộ Thảo Điền is fixed for 9:00-10:00 Tuesday.
    await act({ action: 'OUTCOME', itemId: 'i1', outcome: 'CONFIRMED',
      slots: [{ startsAt: '2026-09-29T02:00:00.000Z', durationMinutes: 60 }] });
    await tick();
    await act({ action: 'REALTOR_REPLY', itemId: 'i2', message: 'Thứ 3 9h được em' });
    await plan();

    const first = db.tables.realtor_messages.find(m => m.direction === 'IN')!;
    const ask = byKey(`OUTCOME:i2:${first.id}`);
    expect(ask).toMatchObject({ action: 'CONTACTED', status: 'PENDING' });
    await tick();
    expect((await act({ action: 'APPROVE_PROPOSAL', proposalId: ask.id })).status).toBe(200);
    expect(db.tables.realtor_messages.filter(m => m.direction === 'OUT').pop()!.body).toContain('bị trùng');

    // Answered by our message: not read again, nothing more proposed about it.
    await plan();
    expect(parses).toBe(1);
    expect(proposals().filter(p => p.item_id === 'i2')).toHaveLength(1);

    // Their next answer misses the other viewing and is recorded as usual.
    await tick();
    await act({ action: 'REALTOR_REPLY', itemId: 'i2', message: 'Vậy 10h30 nhé' });
    // deno-lint-ignore no-explicit-any
    await runPlanner(db as any, {
      now: new Date('2026-09-27T02:00:00Z'),
      parse: () => Promise.resolve({ ...suggestion, slots: [{ startsAt: '2026-09-29T03:30:00.000Z', durationMinutes: 30 }] }),
    });
    const second = db.tables.realtor_messages.filter(m => m.direction === 'IN').pop()!;
    expect(byKey(`OUTCOME:i2:${second.id}`)).toMatchObject({
      action: 'OUTCOME', input: { outcome: 'CONFIRMED', slots: [{ startsAt: '2026-09-29T03:30:00.000Z', durationMinutes: 30 }] },
    });
  });
});

describe('drafted renter replies', () => {
  let seen: string[] = [];
  const draftPlan = () =>
    // deno-lint-ignore no-explicit-any
    runPlanner(db as any, {
      now: new Date(),
      parse: () => Promise.resolve(null),
      draft: ctx => {
        seen.push(JSON.stringify(ctx));
        return Promise.resolve({ kind: 'DRAFT', message: 'It is fully furnished. Ref HV-4KX9', confidence: 'HIGH', needsAgent: false, note: '' });
      },
    });

  beforeEach(() => {
    seen = [];
    db.tables.messages.push({ id: 'in-1', request_id: 'req-1', direction: 'IN', to_phone: '+84912345678',
      body: 'Is the first one furnished? call me 0912345678', status: 'QUEUED', idempotency_key: 'inbound:w1', created_at: new Date().toISOString() });
    db.tables.events.push({ id: 'e10', request_id: 'req-1', item_id: null, type: 'RENTER_REPLIED',
      payload: { intent: 'QUESTION', message_id: 'in-1' }, actor: 'RENTER', occurred_at: new Date().toISOString() });
  });

  it('proposes a drafted reply, written from a context holding no phone number at all', async () => {
    await draftPlan();
    expect(byKey('RENTER:in-1')).toMatchObject({ action: 'REPLY', input: { clientKey: 'reply-in-1' } });
    expect(seen).toHaveLength(1);
    // The renter's number and the agent's number both exist in this database.
    // Neither reaches the model: the listing's contact columns are never
    // selected, and the renter's own digits arrive already in the thread -
    // masked when the prompt is built (renter-reply.test.ts).
    expect(seen[0]).not.toContain('+84901234567');
    expect(seen[0]).not.toContain('+84912345678');
  });

  it('sends it on WhatsApp when approved, and the renter stops waiting', async () => {
    await draftPlan();
    const r = await act({ action: 'APPROVE_PROPOSAL', proposalId: byKey('RENTER:in-1').id });
    expect(r.status).toBe(200);
    expect(db.tables.messages.filter(m => m.direction === 'OUT').map(m => m.body)).toEqual(['It is fully furnished. Ref HV-4KX9']);
    expect(db.tables.events.find(e => e.type === 'REPLY_SENT')!.actor).toBe(ACTOR);
    expect(byKey('RENTER:in-1').status).toBe('APPROVED');
  });

  it('does not pay for a draft that could never be sent', async () => {
    db.tables.renters[0].service_window_expires_at = new Date(Date.now() - 1000).toISOString();
    await draftPlan();
    expect(seen).toHaveLength(0);
    expect(byKey('RENTER:in-1')).toMatchObject({ action: 'ESCALATE' });
    expect(String(byKey('RENTER:in-1').rationale)).toContain('window is closed');
  });

  it('drafts once per reply', async () => {
    await draftPlan();
    await draftPlan();
    expect(seen).toHaveLength(1);
  });
});
