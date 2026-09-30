// One pass of the device's loop: forward what agents said, then send what
// Hausto approved.
//
// The limits here are about how much damage a mistake can do, not about
// looking human. A daily cap bounds how many agents a bug can message; a
// minimum gap between sends stops a burst from going out before anyone can
// press pause. Nothing here tries to disguise what the account is doing.
//
// And the one privacy rule the device itself enforces: a message is forwarded
// only if its sender resolves to a number on Hausto's watch list. Friends,
// family, other clients - anything else - never leaves the device.

import type { ZaloClient, IncomingZalo } from './zalo.ts';
import type { HaustoApi, Ack, Inbound } from './hausto.ts';
import { Journal, hcmcDay } from './journal.ts';

export interface BridgeOptions {
  device: string;
  version: string;
  /** Most messages sent per Ho Chi Minh City day, across restarts. */
  dailyCap: number;
  /** Least time between two sends. */
  minGapMs: number;
  /** Numbers looked up on Zalo per pass, so a long watch list is resolved gradually. */
  resolvePerPass: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

/** A number not found on Zalo is tried again after this long - people do join. */
const RETRY_UNRESOLVED_MS = 6 * 3_600_000;

export interface PassResult { forwarded: number; sent: number; failed: number; capped: boolean }

export class Bridge {
  private readonly uidByPhone = new Map<string, string>();
  private readonly phoneByUid = new Map<string, string>();
  private readonly notOnZalo = new Map<string, number>();
  private watch = new Set<string>();
  private inbox: Inbound[] = [];
  private lastSendAt = 0;
  private lastError: string | null = null;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly api: HaustoApi,
    private readonly zalo: ZaloClient,
    private readonly journal: Journal,
    private readonly opts: BridgeOptions,
  ) {
    this.now = opts.now ?? (() => new Date());
    this.sleep = opts.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));
  }

  start(): Promise<void> {
    return this.zalo.start(m => this.onMessage(m));
  }

  /** Called by the Zalo listener. Keeps only agents Hausto is talking to. */
  onMessage(m: IncomingZalo): void {
    const phone = this.phoneByUid.get(m.fromUid);
    if (!phone || !this.watch.has(phone)) return;
    const text = String(m.text ?? '').trim();
    // A photo from an agent is an answer too - often the whole answer (S7.2b).
    const photos = (m.photos ?? []).filter(u => u.startsWith('https://')).slice(0, 10);
    if (!text && photos.length === 0) return;
    this.inbox.push({ fromPhone: phone, text, providerMessageId: m.msgId, ...(photos.length ? { photos } : {}) });
  }

  private async resolve(phone: string): Promise<string | null> {
    const cached = this.uidByPhone.get(phone);
    if (cached) return cached;
    const missedAt = this.notOnZalo.get(phone);
    if (missedAt && this.now().getTime() - missedAt < RETRY_UNRESOLVED_MS) return null;
    const uid = await this.zalo.resolvePhone(phone);
    if (!uid) {
      this.notOnZalo.set(phone, this.now().getTime());
      return null;
    }
    this.uidByPhone.set(phone, uid);
    this.phoneByUid.set(uid, phone);
    return uid;
  }

  async pass(): Promise<PassResult> {
    const result: PassResult = { forwarded: 0, sent: 0, failed: 0, capped: false };

    // 1. What agents said. First, so a slow outbox never delays a reply
    //    reaching the people waiting on it.
    const batch = this.inbox.splice(0, 50);
    if (batch.length) {
      try {
        await this.api.inbound(batch);
        result.forwarded = batch.length;
      } catch (e) {
        this.inbox.unshift(...batch);
        this.lastError = `forwarding replies failed: ${(e as Error).message}`;
      }
    }

    // 2. What to send, and whose replies to listen for.
    const day = hcmcDay(this.now());
    const pulled = await this.api.pull({
      device: this.opts.device, version: this.opts.version,
      sentToday: this.journal.sentOn(day), error: this.lastError,
    });
    this.lastError = null;
    this.watch = new Set(pulled.watch);

    // Resolve watched numbers ahead of time, a few per pass, so a reply from
    // an agent contacted by hand before the bridge existed is still recognised.
    let lookups = 0;
    for (const phone of this.watch) {
      if (lookups >= this.opts.resolvePerPass) break;
      if (this.uidByPhone.has(phone) || this.notOnZalo.has(phone)) continue;
      lookups += 1;
      try { await this.resolve(phone); } catch (e) { this.lastError = `lookup failed: ${(e as Error).message}`; }
    }

    // 3. Send.
    const acks: Ack[] = [];
    if (!pulled.paused) {
      for (const m of pulled.outbox) {
        // Already sent before a crash ate the ack. Say so; do not send again.
        const prior = this.journal.get(m.messageId);
        if (prior) {
          acks.push({ messageId: m.messageId, sent: true, providerId: prior.providerId });
          continue;
        }
        if (this.journal.sentOn(day) >= this.opts.dailyCap) {
          // Left queued. The lease hands it out again later, and tomorrow
          // the cap resets.
          result.capped = true;
          this.lastError = `daily cap of ${this.opts.dailyCap} reached - the rest wait until tomorrow`;
          break;
        }
        const wait = this.lastSendAt + this.opts.minGapMs - this.now().getTime();
        if (wait > 0) await this.sleep(wait);

        let uid: string | null;
        try {
          uid = await this.resolve(m.phone);
        } catch (e) {
          acks.push({ messageId: m.messageId, sent: false, error: `lookup failed: ${(e as Error).message}` });
          result.failed += 1;
          continue;
        }
        if (!uid) {
          acks.push({ messageId: m.messageId, sent: false, error: 'This number is not on Zalo.' });
          result.failed += 1;
          continue;
        }
        try {
          const sent = await this.zalo.send(uid, m.body);
          // Journal before ack: this line is what makes a crash here harmless.
          this.journal.record(m.messageId, this.now(), sent.providerId);
          this.lastSendAt = this.now().getTime();
          acks.push({ messageId: m.messageId, sent: true, providerId: sent.providerId });
          result.sent += 1;
        } catch (e) {
          acks.push({ messageId: m.messageId, sent: false, error: (e as Error).message.slice(0, 300) });
          result.failed += 1;
        }
      }
    }

    // An ack that fails to land is retried next pass: the journal answers for
    // anything sent, and a failed send is simply handed out again.
    try {
      await this.api.ack(acks);
    } catch (e) {
      this.lastError = `ack failed: ${(e as Error).message}`;
    }
    return result;
  }
}
