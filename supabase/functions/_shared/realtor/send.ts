// The realtor transcript, and the rules for writing to it.
//
// Until this existed the only trace of a broker conversation was the
// operator's note: what we asked, what they answered and how we chased them
// all lived on one person's phone. That is the corpus the AI operator plan
// needs - a broker's words next to the typed outcome an operator chose for
// them - and it was being thrown away on every request.
//
// Three rules, enforced here so no caller can skip one:
//
//   1. Persist before it counts as sent (invariant 3, same as WhatsApp). The
//      row exists before the channel is called.
//   2. Idempotent on a caller-supplied key, so a double-click or a retry is
//      the same message rather than two.
//   3. Nothing about the renter goes to a broker (invariant 4). Drafts are
//      built without renter fields, but the operator can edit them, so every
//      outbound body is checked again here - against phone-shaped text of any
//      kind, and against this request's renter by name and number.

import type { RealtorChannel, RealtorMedium } from './channel.ts';
import { containsInternationalNumber, containsPhoneNumber } from '../viewing/privacy.ts';
import { nationalNumber } from '../whatsapp/inbound.ts';

export type RealtorPurpose =
  | 'REQUEST_VIEWING'   // first contact about a unit
  | 'NUDGE'             // chasing a silent broker
  | 'CONFIRM'           // the renter kept the viewing
  | 'RELEASE'           // the renter did not; stop holding the time
  | 'REPLY';            // inbound: what the broker said

export interface NewRealtorMessage {
  request_id: string;
  item_id: string | null;
  realtor_id: string | null;
  direction: 'OUT' | 'IN';
  medium: RealtorMedium;
  purpose: RealtorPurpose;
  body: string;
  /** OPS:<uuid> today; AGENT:<version> once the AI operator writes. */
  actor: string;
  idempotency_key: string;
}

export interface StoredRealtorMessage extends NewRealtorMessage {
  id: string;
  status: 'QUEUED' | 'SENT' | 'FAILED' | 'RECEIVED';
  created_at?: string;
}

/** Persistence port - a table in production, an array in tests. */
export interface RealtorMessageStore {
  findByIdempotencyKey(key: string): Promise<StoredRealtorMessage | null>;
  insert(row: NewRealtorMessage & { status: StoredRealtorMessage['status'] }): Promise<StoredRealtorMessage>;
  markSent(id: string, providerId?: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  /** Put a FAILED row back in the outbox, with the wording being sent now. */
  requeue(id: string, body: string): Promise<StoredRealtorMessage>;
}

export class RenterIdentityError extends Error {
  constructor(what: string) {
    super(`Refusing to send a broker ${what}. The broker never learns who the renter is (CLAUDE.md invariant 4).`);
    this.name = 'RenterIdentityError';
  }
}

/** Longest body we store. A broker message is a few lines; more is a paste gone wrong. */
export const MAX_BODY = 4000;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Throw if a broker-bound body carries anything identifying the renter.
 *
 * Any phone number at all, not only the renter's: an outbound message to a
 * broker has no reason to contain one, and a number pasted from the wrong
 * window is exactly how a renter's contact would leak. The renter's name is
 * checked as a whole word, and only when it is long enough to mean something.
 */
export function assertNoRenterIdentity(
  body: string,
  renter?: { phone_e164?: string | null; display_name?: string | null },
): void {
  if (containsPhoneNumber(body) || containsInternationalNumber(body)) {
    throw new RenterIdentityError('a phone number');
  }

  const text = body.replace(/https?:\/\/\S+/g, ' ');

  // The renter's own number however it was written - `0901 234 567`,
  // `07700 900123`, `(415) 555-0100` - by its national digits. Stripping a
  // literal +84 here once meant a foreign renter's number was never checked.
  const digits = text.replace(/\D/g, '');
  const national = renter?.phone_e164 ? nationalNumber(renter.phone_e164) : null;
  if (national && national.length >= 7 && digits.includes(national)) {
    throw new RenterIdentityError("the renter's phone number");
  }

  const name = renter?.display_name?.trim();
  if (name && name.length >= 3) {
    const re = new RegExp(`(^|[^\\p{L}])${escapeRegExp(name)}($|[^\\p{L}])`, 'iu');
    if (re.test(text)) throw new RenterIdentityError("the renter's name");
  }
}

export interface SendResult {
  message: StoredRealtorMessage;
  /** True when an existing row was returned instead of a second send. */
  deduplicated: boolean;
}

/**
 * A message to a broker: checked, persisted, then handed to the channel.
 *
 * The renter is passed in rather than looked up because this module has no
 * database; the caller reads it with the service role, and the ops console -
 * which cannot read renters at all - never supplies it.
 */
export async function sendToRealtor(
  store: RealtorMessageStore,
  channel: RealtorChannel,
  opts: {
    requestId: string;
    itemId: string;
    realtorId: string | null;
    medium: RealtorMedium;
    purpose: Exclude<RealtorPurpose, 'REPLY'>;
    body: string;
    actor: string;
    idempotencyKey: string;
    renter?: { phone_e164?: string | null; display_name?: string | null };
  },
): Promise<SendResult> {
  const body = opts.body.trim();
  if (!body) throw new Error('Nothing to send - the message is empty.');
  if (body.length > MAX_BODY) throw new Error(`Message is ${body.length} characters; the limit is ${MAX_BODY}.`);

  // Before idempotency, so a retry of a refused message is refused again
  // rather than returning a row that should never have existed.
  assertNoRenterIdentity(body, opts.renter);

  const existing = await store.findByIdempotencyKey(opts.idempotencyKey);
  if (existing && existing.status !== 'FAILED') return { message: existing, deduplicated: true };

  // A failed send is retried on the same row - same key, the latest wording -
  // rather than refused as a duplicate of the message that never arrived.
  // Only the bridge fails like this (an agent not on Zalo, a device error);
  // the manual channel never does.
  const message = existing
    ? await store.requeue(existing.id, body)
    : await store.insert({
      request_id: opts.requestId,
      item_id: opts.itemId,
      realtor_id: opts.realtorId,
      direction: 'OUT',
      medium: opts.medium,
      purpose: opts.purpose,
      body,
      actor: opts.actor,
      idempotency_key: opts.idempotencyKey,
      status: 'QUEUED',
    });

  const result = await channel.deliver({ messageId: message.id, medium: opts.medium, body });
  if (!result.ok) {
    await store.markFailed(message.id, result.error ?? 'unknown');
    return { message: { ...message, status: 'FAILED' }, deduplicated: false };
  }
  if (result.state === 'SENT') {
    await store.markSent(message.id, result.providerId);
    return { message: { ...message, status: 'SENT' }, deduplicated: false };
  }
  return { message, deduplicated: false };
}

/**
 * What the broker said back, verbatim.
 *
 * Never parsed here and never a source of state: the operator reads it and
 * picks one of the seven outcomes, and the outcome event points at this row.
 * That pairing - their words, our typed reading of them - is the training
 * data. Not checked for renter identity: it is the broker's own text, and a
 * phone number in it is theirs.
 */
export async function recordRealtorReply(
  store: RealtorMessageStore,
  opts: {
    requestId: string;
    itemId: string;
    realtorId: string | null;
    medium: RealtorMedium;
    body: string;
    actor: string;
    idempotencyKey: string;
  },
): Promise<StoredRealtorMessage> {
  const body = opts.body.trim();
  if (!body) throw new Error('The reply is empty.');
  if (body.length > MAX_BODY) throw new Error(`Reply is ${body.length} characters; the limit is ${MAX_BODY}.`);

  const existing = await store.findByIdempotencyKey(opts.idempotencyKey);
  if (existing) return existing;

  return store.insert({
    request_id: opts.requestId,
    item_id: opts.itemId,
    realtor_id: opts.realtorId,
    direction: 'IN',
    medium: opts.medium,
    purpose: 'REPLY',
    body,
    actor: opts.actor,
    idempotency_key: opts.idempotencyKey,
    status: 'RECEIVED',
  });
}
