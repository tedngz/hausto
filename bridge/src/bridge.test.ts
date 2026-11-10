import { describe, it, expect, beforeEach } from 'vitest';
import { Bridge, loginRetryDelay, passRetryDelay } from './bridge.ts';
import { Journal } from './journal.ts';
import type { ZaloClient, IncomingZalo } from './zalo.ts';
import type { HaustoApi, PullResponse, Ack, Inbound, Heartbeat, StatusReport } from './hausto.ts';
import { toLocalPhone, textOf, photoUrlsOf } from './zalo-text.ts';

class FakeZalo implements ZaloClient {
  sent: { uid: string; text: string }[] = [];
  onMessage: (m: IncomingZalo) => void = () => {};
  directory: Record<string, string> = { '+84901234567': 'uid-agent', '+84987654321': 'uid-agent-2' };
  failNext = false;
  /** Logins that fail before one succeeds - an expired session. */
  loginFailures = 0;
  logins = 0;
  start(cb: (m: IncomingZalo) => void) {
    this.logins += 1;
    if (this.loginFailures > 0) { this.loginFailures -= 1; return Promise.reject(new Error('Đăng nhập thất bại')); }
    this.onMessage = cb;
    return Promise.resolve();
  }
  resolvePhone(p: string) { return Promise.resolve(this.directory[p] ?? null); }
  send(uid: string, text: string) {
    if (this.failNext) { this.failNext = false; return Promise.reject(new Error('zalo said no')); }
    this.sent.push({ uid, text });
    return Promise.resolve({ providerId: `z-${this.sent.length}` });
  }
  stop() { return Promise.resolve(); }
}

class FakeApi implements HaustoApi {
  next: PullResponse = { paused: false, outbox: [], watch: [] };
  acks: Ack[] = [];
  inbounds: Inbound[] = [];
  heartbeats: Heartbeat[] = [];
  pull(h: Heartbeat) {
    this.heartbeats.push(h);
    return Promise.resolve(this.next);
  }
  reports: StatusReport[] = [];
  status(r: StatusReport) { this.reports.push(r); return Promise.resolve(); }
  ack(a: Ack[]) { this.acks.push(...a); return Promise.resolve(); }
  inbound(m: Inbound[]) { this.inbounds.push(...m); return Promise.resolve(); }
}

let zalo: FakeZalo;
let api: FakeApi;
let journal: Journal;
let clock: number;
let slept: number[];

const make = (opts: Partial<{ dailyCap: number; minGapMs: number; onIncoming: () => void }> = {}) => new Bridge(api, zalo, journal, {
  device: 'test', version: '0', dailyCap: opts.dailyCap ?? 60, minGapMs: opts.minGapMs ?? 20_000, resolvePerPass: 3,
  watchRefreshMs: 600_000, onIncoming: opts.onIncoming,
  now: () => new Date(clock),
  sleep: ms => { slept.push(ms); clock += ms; return Promise.resolve(); },
});

beforeEach(() => {
  zalo = new FakeZalo();
  api = new FakeApi();
  journal = new Journal(null);
  clock = Date.parse('2026-09-27T03:00:00Z');
  slept = [];
});

describe('sending', () => {
  it('sends what Hausto hands out, to the agent\'s Zalo user, and acks it', async () => {
    api.next = { paused: false, watch: ['+84901234567'], outbox: [{ messageId: 'm1', phone: '+84901234567', body: 'Chào anh' }] };
    const b = make();
    await b.start();
    const r = await b.pass();
    expect(r.sent).toBe(1);
    expect(zalo.sent).toEqual([{ uid: 'uid-agent', text: 'Chào anh' }]);
    expect(api.acks).toEqual([{ messageId: 'm1', sent: true, providerId: 'z-1' }]);
  });

  it('never sends a message twice, even when the ack was lost and it is handed out again', async () => {
    api.next = { paused: false, watch: [], outbox: [{ messageId: 'm1', phone: '+84901234567', body: 'Chào anh' }] };
    const b = make();
    await b.pass();
    await b.pass();
    expect(zalo.sent).toHaveLength(1);
    expect(api.acks.map(a => a.sent)).toEqual([true, true]);
  });

  it('keeps that promise across a restart - the journal is on disk', async () => {
    journal.record('m1', new Date(clock), 'z-9');
    api.next = { paused: false, watch: [], outbox: [{ messageId: 'm1', phone: '+84901234567', body: 'Chào anh' }] };
    await make().pass();
    expect(zalo.sent).toHaveLength(0);
    expect(api.acks).toEqual([{ messageId: 'm1', sent: true, providerId: 'z-9' }]);
  });

  it('spaces sends out by the minimum gap', async () => {
    api.next = { paused: false, watch: [], outbox: [
      { messageId: 'm1', phone: '+84901234567', body: 'a' },
      { messageId: 'm2', phone: '+84987654321', body: 'b' },
    ] };
    await make({ minGapMs: 20_000 }).pass();
    expect(zalo.sent).toHaveLength(2);
    expect(slept).toEqual([20_000]);
  });

  it('stops at the daily cap and leaves the rest queued', async () => {
    api.next = { paused: false, watch: [], outbox: [
      { messageId: 'm1', phone: '+84901234567', body: 'a' },
      { messageId: 'm2', phone: '+84987654321', body: 'b' },
    ] };
    const r = await make({ dailyCap: 1, minGapMs: 0 }).pass();
    expect(r.capped).toBe(true);
    expect(zalo.sent).toHaveLength(1);
    expect(api.acks.map(a => a.messageId)).toEqual(['m1']);
  });

  it('sends nothing while an operator has paused it', async () => {
    api.next = { paused: true, watch: [], outbox: [{ messageId: 'm1', phone: '+84901234567', body: 'a' }] };
    await make().pass();
    expect(zalo.sent).toHaveLength(0);
  });

  it('reports a number not on Zalo, and a send Zalo refused, as failures', async () => {
    api.next = { paused: false, watch: [], outbox: [
      { messageId: 'm1', phone: '+84911111111', body: 'a' },
      { messageId: 'm2', phone: '+84901234567', body: 'b' },
    ] };
    zalo.failNext = true;
    await make({ minGapMs: 0 }).pass();
    expect(api.acks).toEqual([
      { messageId: 'm1', sent: false, error: 'This number is not on Zalo.' },
      { messageId: 'm2', sent: false, error: 'zalo said no' },
    ]);
  });
});

describe('listening', () => {
  it('forwards an agent on the watch list, and nobody else, ever', async () => {
    api.next = { paused: false, watch: ['+84901234567'], outbox: [] };
    const b = make();
    await b.start();
    await b.pass();               // learns the watch list and resolves it

    zalo.onMessage({ fromUid: 'uid-agent', text: 'Còn em, thứ 7 10h nhé', msgId: 'z100' });
    zalo.onMessage({ fromUid: 'uid-mum', text: 'Con ăn cơm chưa?', msgId: 'z101' });
    zalo.onMessage({ fromUid: 'uid-agent-2', text: 'not on the watch list', msgId: 'z102' });
    await b.pass();

    expect(api.inbounds).toEqual([{ fromPhone: '+84901234567', text: 'Còn em, thứ 7 10h nhé', providerMessageId: 'z100' }]);
  });

  it("forwards a watched agent's photos, with or without a caption, and nobody else's", async () => {
    api.next = { paused: false, watch: ['+84901234567'], outbox: [] };
    const b = make();
    await b.start();
    await b.pass();

    zalo.onMessage({ fromUid: 'uid-agent', text: '', photos: ['https://photo.zdn.vn/a.jpg'], msgId: 'z200' });
    zalo.onMessage({ fromUid: 'uid-agent', text: 'Tầng 18', photos: ['https://photo.zdn.vn/b.jpg'], msgId: 'z201' });
    zalo.onMessage({ fromUid: 'uid-mum', text: '', photos: ['https://photo.zdn.vn/family.jpg'], msgId: 'z202' });
    zalo.onMessage({ fromUid: 'uid-agent', text: '', photos: ['http://insecure/c.jpg'], msgId: 'z203' });
    await b.pass();

    expect(api.inbounds).toEqual([
      { fromPhone: '+84901234567', text: '', providerMessageId: 'z200', photos: ['https://photo.zdn.vn/a.jpg'] },
      { fromPhone: '+84901234567', text: 'Tầng 18', providerMessageId: 'z201', photos: ['https://photo.zdn.vn/b.jpg'] },
    ]);
  });

  it('asks for the watch list on the first pass, then only once it is ten minutes old', async () => {
    api.next = { paused: false, watch: ['+84901234567'], outbox: [] };
    const b = make();
    await b.start();
    await b.pass();
    clock += 120_000;
    api.next = { paused: false, outbox: [] };   // what a pull without the list gets back
    await b.pass();
    clock += 480_000;
    api.next = { paused: false, watch: ['+84901234567'], outbox: [] };
    await b.pass();
    expect(api.heartbeats.map(h => h.withWatch)).toEqual([true, false, true]);

    // The list it was not sent again is the list it kept.
    zalo.onMessage({ fromUid: 'uid-agent', text: 'ok em', msgId: 'z1' });
    await b.pass();
    expect(api.inbounds.map(m => m.providerMessageId)).toEqual(['z1']);
  });

  it('hears an agent it was just handed a message for, before the list comes round again', async () => {
    api.next = { paused: false, watch: [], outbox: [] };
    const b = make();
    await b.start();
    await b.pass();
    api.next = { paused: false, outbox: [{ messageId: 'm1', phone: '+84987654321', body: 'Chào chị' }] };
    await b.pass();
    api.next = { paused: false, outbox: [] };
    zalo.onMessage({ fromUid: 'uid-agent-2', text: 'Còn em', msgId: 'z9' });
    zalo.onMessage({ fromUid: 'uid-mum', text: 'Con ăn cơm chưa?', msgId: 'z10' });
    await b.pass();
    expect(api.inbounds).toEqual([{ fromPhone: '+84987654321', text: 'Còn em', providerMessageId: 'z9' }]);
  });

  it('wakes the loop for a watched agent, and for nobody else', async () => {
    let woken = 0;
    api.next = { paused: false, watch: ['+84901234567'], outbox: [] };
    const b = make({ onIncoming: () => { woken += 1; } });
    await b.start();
    await b.pass();
    zalo.onMessage({ fromUid: 'uid-mum', text: 'Con ăn cơm chưa?', msgId: 'z1' });
    expect(woken).toBe(0);
    zalo.onMessage({ fromUid: 'uid-agent', text: 'ok em', msgId: 'z2' });
    expect(woken).toBe(1);
  });

  it('keeps a reply it could not forward and tries again next pass', async () => {
    api.next = { paused: false, watch: ['+84901234567'], outbox: [] };
    const b = make();
    await b.start();
    await b.pass();
    zalo.onMessage({ fromUid: 'uid-agent', text: 'ok em', msgId: 'z1' });
    const real = api.inbound.bind(api);
    api.inbound = () => Promise.reject(new Error('offline'));
    await b.pass();
    api.inbound = real;
    await b.pass();
    expect(api.inbounds.map(m => m.providerMessageId)).toEqual(['z1']);
    // Reported on the very next pull, so the console shows it.
    expect(api.heartbeats[1].error).toMatch(/forwarding replies failed/);
  });
});

describe('logging in', () => {
  it('waits a minute, five, fifteen, then an hour between failed logins - never every 30 seconds', () => {
    expect([0, 1, 2, 3, 10].map(loginRetryDelay)).toEqual([60_000, 300_000, 900_000, 3_600_000, 3_600_000]);
  });

  it('backs off on failed passes instead of restarting, up to fifteen minutes', () => {
    expect([1, 2, 3, 4, 10].map(f => passRetryDelay(f, 120_000))).toEqual([120_000, 240_000, 480_000, 900_000, 900_000]);
  });

  it('tells Hausto why it cannot log in, waits longer each time, and carries on once it can', async () => {
    zalo.loginFailures = 3;
    const b = make();
    expect(await b.connect()).toBe(true);
    expect(zalo.logins).toBe(4);
    expect(slept).toEqual([60_000, 300_000, 900_000]);
    expect(api.reports).toHaveLength(3);
    expect(api.reports[0].error).toMatch(/Zalo login failed \(Đăng nhập thất bại\).*login\.sh.*1 min/);
    expect(api.reports[2].error).toMatch(/15 min/);

    // Logged in for real: replies flow as usual.
    api.next = { paused: false, watch: ['+84901234567'], outbox: [] };
    await b.pass();
    zalo.onMessage({ fromUid: 'uid-agent', text: 'ok em', msgId: 'z1' });
    await b.pass();
    expect(api.inbounds.map(m => m.providerMessageId)).toEqual(['z1']);
  });

  it('still backs off when Hausto cannot hear the report either', async () => {
    zalo.loginFailures = 1;
    api.status = () => Promise.reject(new Error('offline'));
    expect(await make().connect()).toBe(true);
    expect(slept).toEqual([60_000]);
  });

  it('gives up waiting when the service is stopping', async () => {
    zalo.loginFailures = 99;
    let stop = false;
    const b = new Bridge(api, zalo, journal, {
      device: 'test', version: '0', dailyCap: 60, minGapMs: 0, resolvePerPass: 3,
      now: () => new Date(clock),
      sleep: ms => { slept.push(ms); stop = true; return Promise.resolve(); },
    });
    expect(await b.connect(() => stop)).toBe(false);
    expect(zalo.logins).toBe(1);
  });
});

describe('the zca-js adapter\'s pure parts', () => {
  it('turns E.164 into the local form Zalo search takes', () => {
    expect(toLocalPhone('+84901234567')).toBe('0901234567');
  });

  it('reads text out of plain and structured content', () => {
    expect(textOf('hello')).toBe('hello');
    expect(textOf({ msg: 'from an object' })).toBe('from an object');
    expect(textOf({ href: 'a sticker' })).toBe('');
  });

  it('finds the largest image in a photo message, and nothing in anything else', () => {
    const photo = {
      title: '', href: 'https://photo.zdn.vn/w720/a.jpg', thumb: 'https://photo.zdn.vn/w240/a.jpg',
      params: JSON.stringify({ hd: 'https://photo.zdn.vn/w2048/a.jpg', width: 2048 }),
    };
    expect(photoUrlsOf(photo, 'chat.photo')).toEqual(['https://photo.zdn.vn/w2048/a.jpg']);
    expect(photoUrlsOf({ ...photo, params: 'not json' }, 'chat.photo')).toEqual(['https://photo.zdn.vn/w720/a.jpg']);
    // A shared link has an href too; only a message typed as a photo counts.
    expect(photoUrlsOf({ href: 'https://example.com/page' }, 'chat.recommended')).toEqual([]);
    expect(photoUrlsOf(photo, undefined)).toEqual([]);
    expect(photoUrlsOf({ href: 'http://photo.zdn.vn/a.jpg' }, 'chat.photo')).toEqual([]);
    expect(photoUrlsOf('text', 'chat.photo')).toEqual([]);
  });
});
