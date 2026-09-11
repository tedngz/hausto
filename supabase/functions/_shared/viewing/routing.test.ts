import { describe, it, expect, beforeEach } from 'vitest';
import { handleInbound, resolveRequestId } from './routing.ts';
import type { MessageStore, NewMessage, StoredMessage, StoredRenter } from '../whatsapp/send.ts';

const PHONE = '+84901234567';

/** In-memory MessageStore. Mocking the query builder would test the mock. */
class FakeStore implements MessageStore {
  messages: StoredMessage[] = [];
  renter: StoredRenter = {
    id: 'r1', phone_e164: PHONE, service_window_expires_at: null, opted_out_at: null,
  };
  private n = 0;

  findByIdempotencyKey(key: string) {
    return Promise.resolve(this.messages.find(m => m.idempotency_key === key) ?? null);
  }
  insertQueued(row: NewMessage) {
    this.n += 1;
    const m: StoredMessage = { ...row, id: `m${this.n}`, status: 'QUEUED' };
    this.messages.push(m);
    return Promise.resolve(m);
  }
  markSent() { return Promise.resolve(); }
  markFailed() { return Promise.resolve(); }
  countConsecutiveOutbound() { return Promise.resolve(0); }
  getRenter() { return Promise.resolve(this.renter); }
  touchServiceWindow(_id: string, expiresAt: string) {
    this.renter.service_window_expires_at = expiresAt;
    return Promise.resolve();
  }
}

/**
 * Just enough of the supabase query builder to answer the three reads and two
 * writes this module makes. Narrow on purpose - a general fake would be a
 * second implementation of postgrest to get wrong.
 */
function fakeDb(seed: {
  requests?: { id: string; ref: string; renter_id: string; created_at: string }[];
  renters?: { id: string; phone_e164: string; opted_out_at?: string | null }[];
} = {}) {
  const state = {
    requests: seed.requests ?? [],
    renters: seed.renters ?? [{ id: 'r1', phone_e164: PHONE, opted_out_at: null }],
    events: [] as Record<string, unknown>[],
    renterUpdates: [] as Record<string, unknown>[],
  };

  const builder = (table: string) => {
    let rows: Record<string, unknown>[] =
      table === 'viewing_requests' ? [...state.requests]
      : table === 'renters' ? [...state.renters]
      : [];

    const api: Record<string, unknown> = {
      select: () => api,
      eq: (col: string, val: unknown) => { rows = rows.filter(r => r[col] === val); return api; },
      // Sorted here rather than at read time, because postgrest applies the
      // order before the limit - and the newest-request read is only correct
      // if the fake does too.
      order: (col: string, o?: { ascending?: boolean }) => {
        const dir = o?.ascending === false ? -1 : 1;
        rows = [...rows].sort((a, b) => dir * String(a[col]).localeCompare(String(b[col])));
        return api;
      },
      limit: (n: number) => { rows = rows.slice(0, n); return api; },
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      insert: (row: Record<string, unknown>) => {
        if (table === 'events') state.events.push(row);
        if (table === 'renters') state.renters.push(row as { id: string; phone_e164: string });
        return { select: () => ({ single: () => Promise.resolve({ data: row, error: null }) }) };
      },
      update: (patch: Record<string, unknown>) => {
        state.renterUpdates.push(patch);
        return { eq: () => Promise.resolve({ data: null, error: null }) };
      },
    };
    return api;
  };

  return { from: builder, state };
}

const REQUESTS = [
  { id: 'req-old', ref: 'HV-AAAA', renter_id: 'r1', created_at: '2026-09-01T00:00:00Z' },
  { id: 'req-new', ref: 'HV-BBBB', renter_id: 'r1', created_at: '2026-09-10T00:00:00Z' },
];

describe('resolveRequestId', () => {
  it('prefers the ref in the body over the newest request', async () => {
    const db = fakeDb({ requests: REQUESTS });
    expect(await resolveRequestId(db, 'r1', 'my viewing request is HV-AAAA')).toBe('req-old');
  });

  it('falls back to the newest request for a bare reply', async () => {
    const db = fakeDb({ requests: REQUESTS });
    expect(await resolveRequestId(db, 'r1', 'yes please')).toBe('req-new');
  });

  it('returns nothing for a ref that does not resolve, rather than guessing', async () => {
    // Attaching a message to the wrong thread is worse than attaching it to
    // none, and a mistyped ref is exactly when that would happen.
    const db = fakeDb({ requests: REQUESTS });
    expect(await resolveRequestId(db, 'r1', 'about HV-CCCC')).toBeUndefined();
  });

  it('will not resolve another renter\'s ref', async () => {
    const db = fakeDb({ requests: [{ ...REQUESTS[0], renter_id: 'someone-else' }] });
    expect(await resolveRequestId(db, 'r1', 'HV-AAAA')).toBeUndefined();
  });

  it('returns nothing when the renter has no requests at all', async () => {
    expect(await resolveRequestId(fakeDb(), 'r1', 'hello')).toBeUndefined();
  });
});

describe('handleInbound', () => {
  let store: FakeStore;
  beforeEach(() => { store = new FakeStore(); });

  const message = (text: string, id = 'wamid.1') => ({
    from: PHONE, text, providerMessageId: id, timestamp: '2026-09-11T12:00:00.000Z',
  });

  it('re-opens the service window on every inbound', async () => {
    const db = fakeDb({ requests: REQUESTS });
    expect(store.renter.service_window_expires_at).toBeNull();
    await handleInbound(db, store, message('hello'));
    expect(new Date(store.renter.service_window_expires_at!).getTime())
      .toBe(new Date('2026-09-12T12:00:00.000Z').getTime());
  });

  it('stores the message against the request the ref names', async () => {
    const db = fakeDb({ requests: REQUESTS });
    const out = await handleInbound(db, store, message('Hi Hausto - my viewing request is HV-AAAA'));
    expect(out.requestId).toBe('req-old');
    expect(store.messages[0].request_id).toBe('req-old');
    expect(store.messages[0].direction).toBe('IN');
  });

  it('logs RENTER_REPLIED with an unclassified intent - classifying it is S6', async () => {
    const db = fakeDb({ requests: REQUESTS });
    await handleInbound(db, store, message('yes'));
    expect(db.state.events).toHaveLength(1);
    expect(db.state.events[0]).toMatchObject({
      request_id: 'req-new',
      type: 'RENTER_REPLIED',
      actor: 'RENTER',
      payload: { intent: 'UNCLASSIFIED' },
    });
  });

  it('writes no event when the message belongs to no request', async () => {
    // The events table is keyed on a request. A reply from someone who has
    // never made one is a stored message and nothing more.
    const db = fakeDb();
    const out = await handleInbound(db, store, message('hello?'));
    expect(out.requestId).toBeUndefined();
    expect(db.state.events).toHaveLength(0);
    expect(store.messages).toHaveLength(1);
  });

  it('honours an opt-out, and still stores the message that carried it', async () => {
    const db = fakeDb({ requests: REQUESTS });
    const out = await handleInbound(db, store, message('STOP'));
    expect(out.optedOut).toBe(true);
    expect(db.state.renterUpdates[0]).toHaveProperty('opted_out_at');
    expect(store.messages).toHaveLength(1);
  });

  it('does not opt out on a message that merely contains a keyword', async () => {
    const db = fakeDb({ requests: REQUESTS });
    expect((await handleInbound(db, store, message('dung được, thanks'))).optedOut).toBe(false);
  });

  it('is idempotent on a redelivery - Meta retries, and a retry is not a message', async () => {
    const db = fakeDb({ requests: REQUESTS });
    await handleInbound(db, store, message('hello', 'wamid.same'));
    await handleInbound(db, store, message('hello', 'wamid.same'));
    expect(store.messages).toHaveLength(1);
  });
});
