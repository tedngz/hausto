// Where the sending invariants live (CLAUDE.md invariant 3 and the
// message-window rules). The adapter is the transport; this is the contract.
//
// Four rules, all enforced here so no caller can skip one:
//
//   1. Persist before send. A `messages` row exists as QUEUED before anything
//      leaves, so a crash mid-send leaves evidence rather than a gap.
//   2. Idempotency on every send. The key is (request_id, purpose, attempt);
//      the same key twice is the same message, not two.
//   3. sendFreeForm throws on a closed window. It does not fall back to a
//      template - a silent fallback is how a service message becomes a
//      marketing one and the number gets limited.
//   4. No 3-in-a-row. From 2026-10-01 Meta bills service and utility messages
//      inside the window, and the itinerary is meant to be one message. A third
//      consecutive outbound with no inbound between is a bug, so it throws.

import type { WhatsAppAdapter, DeliveryRequest } from './adapter.ts';
import { isApprovedTemplate, templateByName } from './templates.ts';

export class ServiceWindowClosedError extends Error {
  constructor(public readonly renterId: string, public readonly expiredAt: string | null) {
    super(
      `Service window closed for renter ${renterId}` +
        (expiredAt ? ` (expired ${expiredAt})` : ' (never opened)') +
        '. Use sendTemplate with an approved template to re-open it.',
    );
    this.name = 'ServiceWindowClosedError';
  }
}

export class UnapprovedTemplateError extends Error {
  constructor(name: string) {
    super(`Template "${name}" is not in the approved registry. See _shared/whatsapp/templates.ts.`);
    this.name = 'UnapprovedTemplateError';
  }
}

export class OptedOutError extends Error {
  constructor(renterId: string, at: string) {
    super(`Renter ${renterId} opted out at ${at}`);
    this.name = 'OptedOutError';
  }
}

/**
 * The store's unique index said another caller already wrote this key. Its row
 * is the message: the caller that lost the race must not send it again.
 */
export class DuplicateKeyError extends Error {
  constructor(key: string) {
    super(`A message with key ${key} already exists`);
    this.name = 'DuplicateKeyError';
  }
}

export class ConsecutiveMessageError extends Error {
  constructor(renterId: string, count: number) {
    super(
      `Refusing a ${count + 1}th consecutive outbound message to renter ${renterId} with no inbound between. ` +
        'Consolidate into one message - see the message-window rules in CLAUDE.md.',
    );
    this.name = 'ConsecutiveMessageError';
  }
}

/**
 * The narrow slice of persistence this module needs.
 *
 * A port rather than a supabase client, so the rules above can be tested
 * against an in-memory store. Mocking the query builder would test the mock.
 */
export interface MessageStore {
  findByIdempotencyKey(key: string): Promise<StoredMessage | null>;
  insertQueued(row: NewMessage): Promise<StoredMessage>;
  markSent(id: string, providerId?: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  /** Outbound messages since the renter's last inbound, newest first. */
  countConsecutiveOutbound(renterId: string): Promise<number>;
  getRenter(renterId: string): Promise<StoredRenter | null>;
  /**
   * Put a FAILED message back to QUEUED, to be sent again under the same key.
   * Optional: a store without it treats a failed key as sent, as before.
   */
  requeue?(id: string): Promise<void>;
  touchServiceWindow(renterId: string, expiresAt: string): Promise<void>;
  /**
   * Meta's last-known status for a template, or null if never synced.
   *
   * Optional so an in-memory store can omit it. A store that does not
   * implement it falls back to the code flag alone, which is the behaviour
   * before this existed - tests and the mock path are unaffected.
   */
  getTemplateStatus?(name: string): Promise<{ status: string } | null>;
}

export interface StoredRenter {
  id: string;
  phone_e164: string;
  service_window_expires_at: string | null;
  opted_out_at: string | null;
}

export interface NewMessage {
  request_id?: string | null;
  direction: 'OUT' | 'IN';
  channel: 'WHATSAPP';
  to_phone: string;
  body?: string | null;
  template_name?: string | null;
  idempotency_key: string;
}

export interface StoredMessage extends NewMessage {
  id: string;
  status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  provider_id?: string | null;
}

export interface SendResult {
  message: StoredMessage;
  /** True when an existing row was returned instead of a second send. */
  deduplicated: boolean;
}

/** The window is 24 hours from the last inbound message. */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** More than this many outbound in a row, with no inbound between, is a bug. */
export const MAX_CONSECUTIVE_OUTBOUND = 2;

/**
 * Purposes that answer the renter's own message the moment it arrives - the
 * receipt for their request (agent-act.ts, 2026-10-08). Part of that exchange
 * rather than the start of a run of ours, so they do not count towards
 * MAX_CONSECUTIVE_OUTBOUND: without that, the receipt would make the plan or
 * the viewing-day message a refused third. Keep this list to replies sent at
 * once, to a message the renter just sent.
 */
export const ACKNOWLEDGEMENT_PURPOSES = ['REQUEST_RECEIVED'] as const;

export function isAcknowledgement(idempotencyKey: string | null | undefined): boolean {
  const purpose = String(idempotencyKey ?? '').split(':')[1] ?? '';
  return (ACKNOWLEDGEMENT_PURPOSES as readonly string[]).includes(purpose);
}

export function isWindowOpen(renter: StoredRenter, now: Date): boolean {
  if (!renter.service_window_expires_at) return false;
  return new Date(renter.service_window_expires_at).getTime() > now.getTime();
}

/** Idempotency key. Same inputs, same key, therefore same message. */
export function idempotencyKey(requestId: string, purpose: string, attempt = 1): string {
  return `${requestId}:${purpose}:${attempt}`;
}

async function persistThenSend(
  store: MessageStore,
  adapter: WhatsAppAdapter,
  row: NewMessage,
  delivery: Omit<DeliveryRequest, 'messageId'>,
): Promise<SendResult> {
  // Idempotency first: a retry must not produce a second row, let alone a
  // second send. A row that FAILED never reached anyone, so it is sent again on
  // the same key - the key is what the message is, not how often we tried. A
  // row left QUEUED by a crash may or may not have gone; it is not re-sent,
  // because a lost message is caught by the silence clock and a duplicate one
  // lands in a renter's phone.
  const existing = await store.findByIdempotencyKey(row.idempotency_key);
  let message: StoredMessage;
  if (existing && existing.status === 'FAILED' && store.requeue) {
    await store.requeue(existing.id);
    message = { ...existing, status: 'QUEUED' };
  } else if (existing) {
    return { message: existing, deduplicated: true };
  } else {
    // Persist. If the process dies after this line, the row is QUEUED and
    // something can reconcile it. If it died before, nothing was sent.
    try {
      message = await store.insertQueued(row);
    } catch (e) {
      // Another send with this key got its row in between our read and our
      // write. Theirs is the message; sending ours too is the double send the
      // key exists to prevent.
      if (e instanceof DuplicateKeyError) {
        const theirs = await store.findByIdempotencyKey(row.idempotency_key);
        if (theirs) return { message: theirs, deduplicated: true };
      }
      throw e;
    }
  }

  const result = await adapter.deliver({ ...delivery, messageId: message.id });

  if (result.ok) {
    await store.markSent(message.id, result.providerId);
    return { message: { ...message, status: 'SENT', provider_id: result.providerId }, deduplicated: false };
  }
  await store.markFailed(message.id, result.error ?? 'unknown');
  return { message: { ...message, status: 'FAILED' }, deduplicated: false };
}

async function assertCanSend(store: MessageStore, renter: StoredRenter): Promise<void> {
  if (renter.opted_out_at) {
    throw new OptedOutError(renter.id, renter.opted_out_at);
  }
  const consecutive = await store.countConsecutiveOutbound(renter.id);
  if (consecutive >= MAX_CONSECUTIVE_OUTBOUND) {
    throw new ConsecutiveMessageError(renter.id, consecutive);
  }
}

/**
 * A free-form service message. Only legal inside the 24-hour window.
 *
 * Throws `ServiceWindowClosedError` when the window has passed. It does not
 * fall back to a template, and it does not return a soft failure - the caller
 * has to decide, because re-opening a window is a billable, approval-gated act.
 */
export async function sendFreeForm(
  store: MessageStore,
  adapter: WhatsAppAdapter,
  opts: { renterId: string; requestId?: string; purpose: string; body: string; attempt?: number; now?: Date },
): Promise<SendResult> {
  const now = opts.now ?? new Date();
  const renter = await store.getRenter(opts.renterId);
  if (!renter) throw new Error(`Unknown renter ${opts.renterId}`);

  if (!isWindowOpen(renter, now)) {
    throw new ServiceWindowClosedError(renter.id, renter.service_window_expires_at);
  }
  await assertCanSend(store, renter);

  return persistThenSend(
    store,
    adapter,
    {
      request_id: opts.requestId ?? null,
      direction: 'OUT',
      channel: 'WHATSAPP',
      to_phone: renter.phone_e164,
      body: opts.body,
      template_name: null,
      idempotency_key: idempotencyKey(opts.requestId ?? opts.renterId, opts.purpose, opts.attempt ?? 1),
    },
    { toPhone: renter.phone_e164, body: opts.body },
  );
}

/**
 * A template message. Legal with the window shut - that is what it is for.
 *
 * The name is checked against the approved registry before anything is
 * persisted, so an unapproved name cannot leave a SENT row behind.
 */
export async function sendTemplate(
  store: MessageStore,
  adapter: WhatsAppAdapter,
  opts: {
    renterId: string;
    requestId?: string;
    purpose: string;
    templateName: string;
    params?: string[];
    attempt?: number;
  },
): Promise<SendResult> {
  // Two gates, and they guard different failures.
  //
  // The code flag is a deploy gate: a template nobody reviewed must not become
  // sendable because an API said so. Meta's status is the live permission, and
  // it is the one that can be withdrawn after the fact - a template REJECTED on
  // resubmission or PAUSED for quality stays `true` in the code forever, and
  // without this check the first sign would be a graph_400 on the itinerary a
  // renter was waiting for.
  if (!isApprovedTemplate(opts.templateName)) {
    throw new UnapprovedTemplateError(opts.templateName);
  }
  if (store.getTemplateStatus) {
    const live = await store.getTemplateStatus(opts.templateName);
    // A missing row means never synced, not disapproved. Refusing on absence
    // would make a cold database block every template send, which is a worse
    // failure than the one being prevented.
    if (live && live.status !== 'APPROVED') {
      throw new UnapprovedTemplateError(
        `${opts.templateName} (Meta reports ${live.status} as of the last sync)`,
      );
    }
  }
  const spec = templateByName(opts.templateName)!;
  const params = opts.params ?? [];
  if (params.length !== spec.params.length) {
    throw new Error(
      `Template "${spec.name}" expects ${spec.params.length} params (${spec.params.join(', ')}), got ${params.length}`,
    );
  }

  const renter = await store.getRenter(opts.renterId);
  if (!renter) throw new Error(`Unknown renter ${opts.renterId}`);
  await assertCanSend(store, renter);

  return persistThenSend(
    store,
    adapter,
    {
      request_id: opts.requestId ?? null,
      direction: 'OUT',
      channel: 'WHATSAPP',
      to_phone: renter.phone_e164,
      body: null,
      template_name: spec.name,
      idempotency_key: idempotencyKey(opts.requestId ?? opts.renterId, opts.purpose, opts.attempt ?? 1),
    },
    { toPhone: renter.phone_e164, templateName: spec.name, templateParams: params },
  );
}

/**
 * Record an inbound message and re-open the window.
 *
 * Every inbound moves `service_window_expires_at`, which is the only thing that
 * does. Persisting it also resets the consecutive-outbound count, since that is
 * measured from the last inbound.
 */
export async function recordInbound(
  store: MessageStore,
  opts: { renterId: string; requestId?: string; body: string; providerMessageId: string; now?: Date },
): Promise<StoredMessage> {
  const now = opts.now ?? new Date();
  const renter = await store.getRenter(opts.renterId);
  if (!renter) throw new Error(`Unknown renter ${opts.renterId}`);

  const expiresAt = new Date(now.getTime() + SERVICE_WINDOW_MS).toISOString();
  await store.touchServiceWindow(renter.id, expiresAt);

  // Keyed on the provider's id: Meta retries webhook deliveries, and the same
  // inbound arriving twice must not become two rows.
  const key = `inbound:${opts.providerMessageId}`;
  const existing = await store.findByIdempotencyKey(key);
  if (existing) return existing;

  return store.insertQueued({
    request_id: opts.requestId ?? null,
    direction: 'IN',
    channel: 'WHATSAPP',
    to_phone: renter.phone_e164,
    body: opts.body,
    idempotency_key: key,
  });
}
