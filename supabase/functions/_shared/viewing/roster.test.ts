import { describe, it, expect, beforeEach } from 'vitest';
import { FakeDb } from './fake-db.ts';
import { MockAdapter } from '../whatsapp/adapter.ts';
import { SupabaseMessageStore } from '../whatsapp/store.ts';
import { ManualChannel } from '../realtor/channel.ts';
import { SupabaseRealtorMessageStore } from '../realtor/store.ts';
import { performOpsAction, type OpsDeps } from './ops-actions.ts';
import { rankRoster, rosterGap, validateBuildingAgent, ROSTER_TARGET } from './roster.ts';

const COMPLEX = '0b6f7a52-5a8e-4c7a-9f4e-2f7b1f0a9c11';

describe('what an operator may add', () => {
  it('takes a Vietnamese number in any shape, and trims the rest', () => {
    const r = validateBuildingAgent({ complexId: COMPLEX, phone: '0901 234 567', name: ' Harry ', source: 'management' });
    expect(r).toEqual({
      ok: true,
      value: { complexId: COMPLEX, phone: '+84901234567', name: 'Harry', agency: null, source: 'MANAGEMENT', note: null },
    });
  });

  it('defaults to MANUAL', () => {
    const r = validateBuildingAgent({ complexId: COMPLEX, phone: '0901234567' });
    expect(r.ok && r.value.source).toBe('MANUAL');
  });

  it('refuses a foreign number - agents are Vietnamese, and the bridge dials this', () => {
    const r = validateBuildingAgent({ complexId: COMPLEX, phone: '+44 7700 900123' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe('invalid_phone');
  });

  it('refuses LISTING, which is found from listings and never added by hand', () => {
    expect(validateBuildingAgent({ complexId: COMPLEX, phone: '0901234567', source: 'LISTING' }).ok).toBe(false);
  });

  it('refuses something that is not a building', () => {
    expect(validateBuildingAgent({ complexId: 'Empire City', phone: '0901234567' }).ok).toBe(false);
  });
});

describe('who to ask first', () => {
  it('puts agents who have answered us first, then who listed there last', () => {
    const ranked = rankRoster([
      { realtor_id: 'quiet', sources: ['MANUAL'], last_reply_at: null, last_listed_at: null },
      { realtor_id: 'lister', sources: ['LISTING'], last_reply_at: null, last_listed_at: '2026-09-20T00:00:00Z' },
      { realtor_id: 'answers', sources: ['MANUAL'], last_reply_at: '2026-09-01T00:00:00Z', last_listed_at: null },
    ]);
    expect(ranked.map(a => a.realtor_id)).toEqual(['answers', 'lister', 'quiet']);
  });

  it('counts how far short of the target a building is', () => {
    expect(rosterGap(0)).toBe(ROSTER_TARGET);
    expect(rosterGap(ROSTER_TARGET + 2)).toBe(0);
  });
});

describe('ADD_BUILDING_AGENT / REMOVE_BUILDING_AGENT', () => {
  let db: FakeDb;
  let deps: OpsDeps;
  // deno-lint-ignore no-explicit-any
  const act = (input: Record<string, unknown>) => performOpsAction(db as any, deps, 'OPS:op-1', input);

  beforeEach(() => {
    db = new FakeDb();
    db.tables.complexes = [{ id: COMPLEX, name: 'Empire City' }];
    db.tables.realtors = [];
    db.tables.complex_agents = [];
    deps = {
      whatsapp: new MockAdapter(),
      // deno-lint-ignore no-explicit-any
      messages: new SupabaseMessageStore(db as any),
      realtorChannel: new ManualChannel(),
      // deno-lint-ignore no-explicit-any
      realtorMessages: new SupabaseRealtorMessageStore(db as any),
    };
  });

  it('creates the agent and puts them on the building, stamped with who did it', async () => {
    const r = await act({ action: 'ADD_BUILDING_AGENT', complexId: COMPLEX, phone: '0901 234 567', name: 'Harry', agency: 'Savills', source: 'MANAGEMENT', note: 'Leasing desk, tower 2' });
    expect(r.status).toBe(200);
    expect(db.tables.realtors).toHaveLength(1);
    expect(db.tables.realtors[0]).toMatchObject({ phone_e164: '+84901234567', display_name: 'Harry', agency: 'Savills' });
    expect(db.tables.complex_agents[0]).toMatchObject({
      complex_id: COMPLEX, realtor_id: db.tables.realtors[0].id, source: 'MANAGEMENT', note: 'Leasing desk, tower 2', added_by: 'OPS:op-1',
    });
    // A roster entry is a contact, not a request's state: no event.
    expect(db.tables.events).toHaveLength(0);
  });

  it('reuses an agent already on file, filling a blank name without overwriting one', async () => {
    db.tables.realtors.push({ id: 'r-1', phone_e164: '+84901234567', display_name: 'Anh Harry', agency: null });
    await act({ action: 'ADD_BUILDING_AGENT', complexId: COMPLEX, phone: '0901234567', name: 'Harry', agency: 'Savills' });
    expect(db.tables.realtors).toHaveLength(1);
    expect(db.tables.realtors[0]).toMatchObject({ display_name: 'Anh Harry', agency: 'Savills' });
    expect(db.tables.complex_agents[0].realtor_id).toBe('r-1');
  });

  it('adding the same agent twice updates the entry rather than failing', async () => {
    await act({ action: 'ADD_BUILDING_AGENT', complexId: COMPLEX, phone: '0901234567', note: 'first' });
    await act({ action: 'ADD_BUILDING_AGENT', complexId: COMPLEX, phone: '0901234567', note: 'second', source: 'MANAGEMENT' });
    expect(db.tables.complex_agents).toHaveLength(1);
    expect(db.tables.complex_agents[0]).toMatchObject({ note: 'second', source: 'MANAGEMENT' });
  });

  it('refuses an unknown building and a bad number, writing nothing', async () => {
    expect((await act({ action: 'ADD_BUILDING_AGENT', complexId: '0b6f7a52-0000-4c7a-9f4e-2f7b1f0a9c11', phone: '0901234567' })).status).toBe(404);
    expect((await act({ action: 'ADD_BUILDING_AGENT', complexId: COMPLEX, phone: '12345' })).status).toBe(400);
    expect(db.tables.realtors).toHaveLength(0);
    expect(db.tables.complex_agents).toHaveLength(0);
  });

  it('removes an entry and keeps the agent on file', async () => {
    await act({ action: 'ADD_BUILDING_AGENT', complexId: COMPLEX, phone: '0901234567' });
    const realtorId = db.tables.realtors[0].id;
    const r = await act({ action: 'REMOVE_BUILDING_AGENT', complexId: COMPLEX, realtorId });
    expect(r.status).toBe(200);
    expect(db.tables.complex_agents).toHaveLength(0);
    expect(db.tables.realtors).toHaveLength(1);
  });
});
