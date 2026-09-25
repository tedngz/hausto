import { describe, it, expect, beforeEach } from 'vitest';
import {
  sendToRealtor,
  recordRealtorReply,
  assertNoRenterIdentity,
  RenterIdentityError,
  type RealtorMessageStore,
  type StoredRealtorMessage,
} from './send.ts';
import { ManualChannel, realtorChannelFromEnv, type RealtorChannel } from './channel.ts';
import { draftForRealtor, nudgeDraft, confirmDraft, releaseDraft } from './drafts.ts';

/** An array with the one constraint that matters: idempotency_key is unique. */
class MemoryStore implements RealtorMessageStore {
  rows: StoredRealtorMessage[] = [];
  /** Order of operations, so persist-before-send is assertable. */
  log: string[] = [];

  findByIdempotencyKey(key: string) {
    return Promise.resolve(this.rows.find(r => r.idempotency_key === key) ?? null);
  }
  insert(row: Omit<StoredRealtorMessage, 'id'>) {
    if (this.rows.some(r => r.idempotency_key === row.idempotency_key)) throw new Error('23505');
    const stored = { ...row, id: `rm${this.rows.length + 1}` } as StoredRealtorMessage;
    this.rows.push(stored);
    this.log.push(`insert:${stored.status}`);
    return Promise.resolve(stored);
  }
  markSent(id: string) {
    this.rows.find(r => r.id === id)!.status = 'SENT';
    this.log.push('sent');
    return Promise.resolve();
  }
  markFailed(id: string) {
    this.rows.find(r => r.id === id)!.status = 'FAILED';
    return Promise.resolve();
  }
}

let store: MemoryStore;
let channel: ManualChannel;

const base = {
  requestId: 'req-1',
  itemId: 'item-1',
  realtorId: 'realtor-1',
  medium: 'ZALO' as const,
  purpose: 'REQUEST_VIEWING' as const,
  actor: 'OPS:u1',
};

beforeEach(() => {
  store = new MemoryStore();
  channel = new ManualChannel();
});

describe('a message to a broker', () => {
  it('is persisted before the channel sees it, then marked sent', () => {
    const order: string[] = [];
    const spy: RealtorChannel = {
      mode: 'manual',
      deliver: req => {
        order.push(`deliver:${store.rows.find(r => r.id === req.messageId)?.status}`);
        return Promise.resolve({ ok: true, state: 'SENT' });
      },
    };
    return sendToRealtor(store, spy, { ...base, body: 'Chào anh', idempotencyKey: 'k1' }).then(r => {
      expect(order).toEqual(['deliver:QUEUED']);
      expect(r.message.status).toBe('SENT');
      expect(store.rows[0]).toMatchObject({ direction: 'OUT', purpose: 'REQUEST_VIEWING', body: 'Chào anh', actor: 'OPS:u1' });
    });
  });

  it('is one message however many times the same key is sent', async () => {
    await sendToRealtor(store, channel, { ...base, body: 'Chào anh', idempotencyKey: 'k1' });
    const again = await sendToRealtor(store, channel, { ...base, body: 'Chào anh', idempotencyKey: 'k1' });
    expect(again.deduplicated).toBe(true);
    expect(store.rows).toHaveLength(1);
    expect(channel.delivered).toHaveLength(1);
  });

  it('stays QUEUED when the channel only queued it', async () => {
    const bridge: RealtorChannel = { mode: 'bridge', deliver: () => Promise.resolve({ ok: true, state: 'QUEUED' }) };
    const r = await sendToRealtor(store, bridge, { ...base, body: 'Chào anh', idempotencyKey: 'k1' });
    expect(r.message.status).toBe('QUEUED');
  });

  it('refuses an empty body', async () => {
    await expect(sendToRealtor(store, channel, { ...base, body: '  ', idempotencyKey: 'k1' })).rejects.toThrow();
    expect(store.rows).toHaveLength(0);
  });
});

describe('the renter never reaches a broker (invariant 4)', () => {
  it('refuses any phone number, before anything is stored', async () => {
    await expect(sendToRealtor(store, channel, {
      ...base, body: 'Khách số 0912 345 678 nhé', idempotencyKey: 'k1',
    })).rejects.toBeInstanceOf(RenterIdentityError);
    expect(store.rows).toHaveLength(0);
    expect(channel.delivered).toHaveLength(0);
  });

  it("refuses this renter's name as a whole word, case-insensitively", () => {
    const renter = { phone_e164: '+84912345678', display_name: 'Minh Anh' };
    expect(() => assertNoRenterIdentity('Khách tên minh anh muốn xem', renter)).toThrow(RenterIdentityError);
    expect(() => assertNoRenterIdentity('Khách muốn xem căn Minh Anhh Tower', renter)).not.toThrow();
  });

  it("ignores a name too short to mean anything", () => {
    expect(() => assertNoRenterIdentity('An ninh tốt không ạ?', { display_name: 'An' })).not.toThrow();
  });

  it('lets a listing link through even when its id looks like a number', () => {
    expect(() => assertNoRenterIdentity('Căn này: https://www.nhatot.com/thue/0912345678.htm')).not.toThrow();
  });

  it('holds for every draft we ship, with a renter who would be easy to leak', () => {
    const renter = { phone_e164: '+84912345678', display_name: 'Nguyen Van Binh' };
    const drafts = [
      draftForRealtor({
        listingTitle: 'Căn hộ 2PN Thảo Điền', listingUrl: 'https://batdongsan.com.vn/pr41234567',
        priceVnd: 15_000_000, availability: [{ date: '2026-09-28', part: 'MORNING' }],
      }),
      nudgeDraft({ listingTitle: 'Căn hộ 2PN Thảo Điền' }),
      confirmDraft({ listingTitle: 'Căn hộ 2PN Thảo Điền', startsAt: '2026-09-28T03:30:00.000Z' }),
      releaseDraft({ listingTitle: 'Căn hộ 2PN Thảo Điền' }),
    ];
    for (const d of drafts) expect(() => assertNoRenterIdentity(d, renter)).not.toThrow();
  });
});

describe('what the broker said back', () => {
  it('is stored verbatim as RECEIVED, and never checked for renter identity', async () => {
    // The broker's own number in their own reply is theirs to give.
    const r = await recordRealtorReply(store, {
      requestId: 'req-1', itemId: 'item-1', realtorId: 'realtor-1', medium: 'ZALO',
      body: 'Còn em, 10h thứ 7 được. Gọi anh 0912345678', actor: 'OPS:u1', idempotencyKey: 'rk1',
    });
    expect(r).toMatchObject({ direction: 'IN', purpose: 'REPLY', status: 'RECEIVED' });
  });

  it('is one row per key', async () => {
    const opts = {
      requestId: 'req-1', itemId: 'item-1', realtorId: null, medium: 'ZALO' as const,
      body: 'Còn em', actor: 'OPS:u1', idempotencyKey: 'rk1',
    };
    await recordRealtorReply(store, opts);
    await recordRealtorReply(store, opts);
    expect(store.rows).toHaveLength(1);
  });
});

describe('the drafts', () => {
  it('name the confirmed time in Ho Chi Minh City, not UTC', () => {
    // 03:30Z is 10:30 local. A broker told 03:30 is a broker at the door at dawn.
    expect(confirmDraft({ listingTitle: 'X', startsAt: '2026-09-28T03:30:00.000Z' })).toContain('10:30 ngày 28/09');
  });

  it('never say why the renter is not coming', () => {
    const d = releaseDraft({ listingTitle: 'X' });
    expect(d).toContain('không cần giữ lịch');
  });
});

describe('choosing a channel', () => {
  it('is manual by default and refuses anything not built', () => {
    expect(realtorChannelFromEnv({}).mode).toBe('manual');
    expect(realtorChannelFromEnv({ REALTOR_CHANNEL: 'manual' }).mode).toBe('manual');
    // A bridge that silently fell back to manual would record drafts as SENT
    // that never left.
    expect(() => realtorChannelFromEnv({ REALTOR_CHANNEL: 'bridge' })).toThrow();
  });
});
