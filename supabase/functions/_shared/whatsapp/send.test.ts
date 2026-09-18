import { describe, it, expect, beforeEach } from 'vitest';
import { MockAdapter, adapterFromEnv, CloudApiAdapter } from './adapter.ts';
import { TEMPLATES } from './templates.ts';
import {
  sendFreeForm,
  sendTemplate,
  recordInbound,
  isWindowOpen,
  idempotencyKey,
  ServiceWindowClosedError,
  UnapprovedTemplateError,
  ConsecutiveMessageError,
  SERVICE_WINDOW_MS,
  type MessageStore,
  type StoredMessage,
  type StoredRenter,
  type NewMessage,
} from './send.ts';

const NOW = new Date('2026-09-11T12:00:00.000Z');

/** In-memory MessageStore. Mocking the query builder would test the mock. */
class FakeStore implements MessageStore {
  messages: StoredMessage[] = [];
  renters = new Map<string, StoredRenter>();
  private n = 0;

  constructor(renter?: Partial<StoredRenter>) {
    this.renters.set('r1', {
      id: 'r1',
      phone_e164: '+84901234567',
      service_window_expires_at: new Date(NOW.getTime() + 60_000).toISOString(),
      opted_out_at: null,
      ...renter,
    });
  }

  findByIdempotencyKey(key: string) {
    return Promise.resolve(this.messages.find(m => m.idempotency_key === key) ?? null);
  }
  insertQueued(row: NewMessage) {
    this.n += 1;
    const m: StoredMessage = { ...row, id: `m${this.n}`, status: 'QUEUED' };
    this.messages.push(m);
    return Promise.resolve(m);
  }
  markSent(id: string, providerId?: string) {
    const m = this.messages.find(x => x.id === id)!;
    m.status = 'SENT';
    m.provider_id = providerId;
    return Promise.resolve();
  }
  markFailed(id: string, error: string) {
    const m = this.messages.find(x => x.id === id)!;
    m.status = 'FAILED';
    void error;
    return Promise.resolve();
  }
  countConsecutiveOutbound(_renterId: string) {
    let count = 0;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].direction === 'IN') break;
      count++;
    }
    return Promise.resolve(count);
  }
  getRenter(id: string) {
    return Promise.resolve(this.renters.get(id) ?? null);
  }
  touchServiceWindow(id: string, expiresAt: string) {
    this.renters.get(id)!.service_window_expires_at = expiresAt;
    return Promise.resolve();
  }
}

let store: FakeStore;
let adapter: MockAdapter;
beforeEach(() => {
  store = new FakeStore();
  adapter = new MockAdapter();
});

describe('the service window', () => {
  it('sendFreeForm throws when the window has closed, and sends nothing', async () => {
    const closed = new FakeStore({ service_window_expires_at: new Date(NOW.getTime() - 1000).toISOString() });
    await expect(
      sendFreeForm(closed, adapter, { renterId: 'r1', purpose: 'p', body: 'hi', now: NOW }),
    ).rejects.toBeInstanceOf(ServiceWindowClosedError);

    // The refusal has to be total: no row, no delivery. A QUEUED row here would
    // look like something to retry.
    expect(closed.messages).toHaveLength(0);
    expect(adapter.delivered).toHaveLength(0);
  });

  it('throws when the window never opened at all', async () => {
    const never = new FakeStore({ service_window_expires_at: null });
    await expect(
      sendFreeForm(never, adapter, { renterId: 'r1', purpose: 'p', body: 'hi', now: NOW }),
    ).rejects.toBeInstanceOf(ServiceWindowClosedError);
  });

  it('does not silently fall back to a template', async () => {
    const closed = new FakeStore({ service_window_expires_at: null });
    await expect(
      sendFreeForm(closed, adapter, { renterId: 'r1', purpose: 'p', body: 'hi', now: NOW }),
    ).rejects.toThrow();
    expect(closed.messages.filter(m => m.template_name)).toHaveLength(0);
  });

  it('an inbound message re-opens it for 24 hours', async () => {
    const closed = new FakeStore({ service_window_expires_at: null });
    await recordInbound(closed, { renterId: 'r1', body: 'hello', providerMessageId: 'wamid.1', now: NOW });

    const renter = closed.renters.get('r1')!;
    expect(isWindowOpen(renter, NOW)).toBe(true);
    expect(new Date(renter.service_window_expires_at!).getTime()).toBe(NOW.getTime() + SERVICE_WINDOW_MS);
  });

  it('the same inbound delivered twice is recorded once', async () => {
    await recordInbound(store, { renterId: 'r1', body: 'hi', providerMessageId: 'wamid.1', now: NOW });
    await recordInbound(store, { renterId: 'r1', body: 'hi', providerMessageId: 'wamid.1', now: NOW });
    expect(store.messages.filter(m => m.direction === 'IN')).toHaveLength(1);
  });
});

describe('persist before send', () => {
  it('writes the row before the adapter is called', async () => {
    const order: string[] = [];
    const spy = new MockAdapter();
    const origDeliver = spy.deliver.bind(spy);
    spy.deliver = (req) => {
      // By the time the transport runs, the row must already exist.
      order.push(`deliver:${store.messages.length}`);
      return origDeliver(req);
    };

    await sendFreeForm(store, spy, { renterId: 'r1', purpose: 'ack', body: 'hi', now: NOW });
    expect(order).toEqual(['deliver:1']);
    expect(store.messages[0].status).toBe('SENT');
  });

  it('leaves a FAILED row rather than losing the attempt', async () => {
    adapter.failNextDelivery();
    const res = await sendFreeForm(store, adapter, { renterId: 'r1', purpose: 'ack', body: 'hi', now: NOW });
    expect(res.message.status).toBe('FAILED');
    expect(store.messages).toHaveLength(1);
    expect(store.messages[0].status).toBe('FAILED');
  });
});

describe('idempotency', () => {
  it('the same key twice sends once', async () => {
    const opts = { renterId: 'r1', requestId: 'req1', purpose: 'itinerary', body: 'x', now: NOW };
    const first = await sendFreeForm(store, adapter, opts);
    const second = await sendFreeForm(store, adapter, opts);

    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(second.message.id).toBe(first.message.id);
    expect(adapter.delivered).toHaveLength(1);
    expect(store.messages).toHaveLength(1);
  });

  it('a different attempt is a different message', async () => {
    const base = { renterId: 'r1', requestId: 'req1', purpose: 'nudge', body: 'x', now: NOW };
    await sendFreeForm(store, adapter, { ...base, attempt: 1 });
    // An inbound resets the consecutive count so the guard is not what stops us.
    await recordInbound(store, { renterId: 'r1', body: 'ok', providerMessageId: 'w1', now: NOW });
    await sendFreeForm(store, adapter, { ...base, attempt: 2 });
    expect(adapter.delivered).toHaveLength(2);
  });

  it('builds a stable key from request, purpose and attempt', () => {
    expect(idempotencyKey('req1', 'itinerary', 1)).toBe('req1:itinerary:1');
    expect(idempotencyKey('req1', 'itinerary')).toBe('req1:itinerary:1');
  });
});

describe('no three in a row', () => {
  it('refuses a third consecutive outbound with no inbound between', async () => {
    const send = (purpose: string) =>
      sendFreeForm(store, adapter, { renterId: 'r1', requestId: 'req1', purpose, body: 'x', now: NOW });

    await send('one');
    await send('two');
    await expect(send('three')).rejects.toBeInstanceOf(ConsecutiveMessageError);
    expect(adapter.delivered).toHaveLength(2);
  });

  it('an inbound resets the count', async () => {
    const send = (purpose: string) =>
      sendFreeForm(store, adapter, { renterId: 'r1', requestId: 'req1', purpose, body: 'x', now: NOW });

    await send('one');
    await send('two');
    await recordInbound(store, { renterId: 'r1', body: 'ok', providerMessageId: 'w1', now: NOW });
    await expect(send('three')).resolves.toMatchObject({ deduplicated: false });
  });

  it('applies to templates too', async () => {
    // Otherwise the rule is trivially escapable by sending templates instead.
    const wasApproved = TEMPLATES.REQUEST_RECEIVED.approved;
    TEMPLATES.REQUEST_RECEIVED.approved = true;
    try {
      await sendFreeForm(store, adapter, { renterId: 'r1', purpose: 'a', body: 'x', now: NOW });
      await sendFreeForm(store, adapter, { renterId: 'r1', purpose: 'b', body: 'x', now: NOW });
      await expect(
        sendTemplate(store, adapter, {
          renterId: 'r1',
          purpose: 'c',
          templateName: 'request_received',
          params: ['a', 'b', 'c'],
        }),
      ).rejects.toBeInstanceOf(ConsecutiveMessageError);
    } finally {
      TEMPLATES.REQUEST_RECEIVED.approved = wasApproved;
    }
  });
});

describe('templates', () => {
  it('refuses a name that is not in the registry', async () => {
    await expect(
      sendTemplate(store, adapter, { renterId: 'r1', purpose: 'p', templateName: 'made_up', params: [] }),
    ).rejects.toBeInstanceOf(UnapprovedTemplateError);
    expect(store.messages).toHaveLength(0);
  });

  it('refuses a registered template the code flag has not approved', async () => {
    // Sending one would be rejected at Meta's end after we had already written
    // a row claiming success. This used to assert that ITINERARY_READY ships
    // unapproved, which was true until Meta approved the five - it documented
    // the state of the rollout rather than the rule. The rule is what the flag
    // does, so the test now arranges the flag it needs.
    const was = TEMPLATES.ITINERARY_READY.approved;
    TEMPLATES.ITINERARY_READY.approved = false;
    try {
      await expect(
        sendTemplate(store, adapter, {
          renterId: 'r1',
          purpose: 'p',
          templateName: 'itinerary_ready',
          params: ['a', 'b', 'c'],
        }),
      ).rejects.toBeInstanceOf(UnapprovedTemplateError);
    } finally {
      TEMPLATES.ITINERARY_READY.approved = was;
    }
  });

  it('checks the parameter count', async () => {
    const wasApproved = TEMPLATES.REQUEST_RECEIVED.approved;
    TEMPLATES.REQUEST_RECEIVED.approved = true;
    try {
      await expect(
        sendTemplate(store, adapter, {
          renterId: 'r1',
          purpose: 'p',
          templateName: 'request_received',
          params: ['only-one'],
        }),
      ).rejects.toThrow(/expects 3 params/);
    } finally {
      TEMPLATES.REQUEST_RECEIVED.approved = wasApproved;
    }
  });

  it('sends with the window shut, which is the point of a template', async () => {
    const closed = new FakeStore({ service_window_expires_at: null });
    const wasApproved = TEMPLATES.REQUEST_RECEIVED.approved;
    TEMPLATES.REQUEST_RECEIVED.approved = true;
    try {
      const res = await sendTemplate(closed, adapter, {
        renterId: 'r1',
        purpose: 'ack',
        templateName: 'request_received',
        params: ['Ted', 'HV-4KX2', '3'],
      });
      expect(res.message.status).toBe('SENT');
      expect(res.message.template_name).toBe('request_received');
    } finally {
      TEMPLATES.REQUEST_RECEIVED.approved = wasApproved;
    }
  });
});

describe('opt-out', () => {
  it('refuses to send to a renter who opted out', async () => {
    const out = new FakeStore({ opted_out_at: '2026-09-01T00:00:00.000Z' });
    await expect(
      sendFreeForm(out, adapter, { renterId: 'r1', purpose: 'p', body: 'x', now: NOW }),
    ).rejects.toThrow(/opted out/);
    expect(out.messages).toHaveLength(0);
  });
});

describe('adapter selection', () => {
  it('defaults to mock', () => {
    expect(adapterFromEnv({}).mode).toBe('mock');
    expect(adapterFromEnv({ WHATSAPP_MODE: 'anything-else' }).mode).toBe('mock');
  });

  it('selects cloud when configured', () => {
    const a = adapterFromEnv({
      WHATSAPP_MODE: 'cloud',
      WHATSAPP_PHONE_NUMBER_ID: '123',
      WHATSAPP_ACCESS_TOKEN: 'tok',
    });
    expect(a).toBeInstanceOf(CloudApiAdapter);
  });

  it('throws rather than falling back to mock when cloud is half-configured', () => {
    // Falling back would fill `messages` with SENT rows nobody received.
    expect(() => adapterFromEnv({ WHATSAPP_MODE: 'cloud' })).toThrow(/missing/);
  });
});

describe('the live template gate', () => {
  /** A store that also knows what Meta last said about a template. */
  function storeWithStatus(status: string | null) {
    const base = new FakeStore();
    return Object.assign(base, {
      getTemplateStatus: () => Promise.resolve(status ? { status } : null),
    });
  }

  it('refuses a code-approved template that Meta has since paused', async () => {
    // The failure a code flag can never catch: approval is not permanent. Meta
    // pauses templates whose quality drops, and the flag stays true through it.
    const wasApproved = TEMPLATES.REQUEST_RECEIVED.approved;
    TEMPLATES.REQUEST_RECEIVED.approved = true;
    try {
      const store = storeWithStatus('PAUSED');
      await expect(
        sendTemplate(store, new MockAdapter(), {
          renterId: 'r1', purpose: 'p', templateName: 'request_received',
          params: ['a', 'b', 'c'],
        }),
      ).rejects.toBeInstanceOf(UnapprovedTemplateError);
      // And nothing was written: the refusal happens before the row.
      expect(store.messages).toHaveLength(0);
    } finally {
      TEMPLATES.REQUEST_RECEIVED.approved = wasApproved;
    }
  });

  it('sends when the code flag and Meta agree', async () => {
    const wasApproved = TEMPLATES.REQUEST_RECEIVED.approved;
    TEMPLATES.REQUEST_RECEIVED.approved = true;
    try {
      const res = await sendTemplate(storeWithStatus('APPROVED'), new MockAdapter(), {
        renterId: 'r1', purpose: 'p', templateName: 'request_received', params: ['a', 'b', 'c'],
      });
      expect(res.message.status).toBe('SENT');
    } finally {
      TEMPLATES.REQUEST_RECEIVED.approved = wasApproved;
    }
  });

  it('falls back to the code flag when the template has never been synced', async () => {
    // A missing row means "not synced", not "disapproved". Refusing on absence
    // would let a cold database block every template send - a worse failure
    // than the one being prevented.
    const wasApproved = TEMPLATES.REQUEST_RECEIVED.approved;
    TEMPLATES.REQUEST_RECEIVED.approved = true;
    try {
      const res = await sendTemplate(storeWithStatus(null), new MockAdapter(), {
        renterId: 'r1', purpose: 'p', templateName: 'request_received', params: ['a', 'b', 'c'],
      });
      expect(res.message.status).toBe('SENT');
    } finally {
      TEMPLATES.REQUEST_RECEIVED.approved = wasApproved;
    }
  });

  it('still refuses when Meta approves but the code flag does not', async () => {
    // The deploy gate survives the sync: Meta approving a template does not
    // make it sendable on its own. Somebody still flips the flag and deploys.
    const was = TEMPLATES.ITINERARY_READY.approved;
    TEMPLATES.ITINERARY_READY.approved = false;
    try {
      await expect(
        sendTemplate(storeWithStatus('APPROVED'), new MockAdapter(), {
          renterId: 'r1', purpose: 'p', templateName: 'itinerary_ready', params: ['a', 'b', 'c'],
        }),
      ).rejects.toBeInstanceOf(UnapprovedTemplateError);
    } finally {
      TEMPLATES.ITINERARY_READY.approved = was;
    }
  });

  it('works with a store that does not implement the lookup at all', async () => {
    const wasApproved = TEMPLATES.REQUEST_RECEIVED.approved;
    TEMPLATES.REQUEST_RECEIVED.approved = true;
    try {
      const res = await sendTemplate(new FakeStore(), new MockAdapter(), {
        renterId: 'r1', purpose: 'p', templateName: 'request_received', params: ['a', 'b', 'c'],
      });
      expect(res.message.status).toBe('SENT');
    } finally {
      TEMPLATES.REQUEST_RECEIVED.approved = wasApproved;
    }
  });
});
