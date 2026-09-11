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
  touchServiceWindow(renterId: string, expiresAt: string): Promise<void>;
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
  // second send.
  const existing = await store.findByIdempotencyKey(row.idempotency_key);
  if (existing) return { message: existing, deduplicated: true };

  // Persist. If the process dies after this line, the row is QUEUED and
  // something can reconcile it. If it died before, nothing was sent.
  const message = await store.insertQueued(row);

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
    throw new Error(`Renter ${renter.id} opted out at ${renter.opted_out_at}`);
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
  if (!isApprovedTemplate(opts.templateName)) {
    throw new UnapprovedTemplateError(opts.templateName);
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
