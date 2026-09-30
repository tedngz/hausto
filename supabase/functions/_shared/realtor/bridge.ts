// The Hausto half of the Zalo bridge (stage 3): what the always-on device
// asks for, and what it reports back. `zalo-bridge` is the HTTP door; this is
// the logic, shared so it runs against the in-memory database in tests.
//
// Three things it holds to:
//
//   1. Each message is sent once. The device claims rows before sending
//      (`claimed_at`, a lease), acks each one, and keeps its own journal - so
//      two pulls cannot both send a row, and a crash between send and ack
//      does not resend it (bridge/src/journal.ts).
//   2. The log says "contacted" only when a message left. The event a send
//      stands for waits on the row (`on_sent_event`) and is written by the ack.
//   3. The device only ever hands over agents' messages. It reads a real Zalo
//      account with other chats in it; it forwards only senders on the watch
//      list this returns, and anything else that arrives is dropped here
//      without being stored.

import { toE164 } from '../whatsapp/inbound.ts';
import { recordRealtorReply } from './send.ts';
import { SupabaseRealtorMessageStore } from './store.ts';

// deno-lint-ignore no-explicit-any
type Supa = any;

/** A claim older than this is taken again. Longer than any send, shorter than an operator's patience. */
export const CLAIM_LEASE_MS = 10 * 60_000;

/** Messages handed out per pull. The device's own daily cap is the real limit. */
export const PULL_LIMIT = 10;

/** How far back an agent counts as one we are talking to. Same horizon as the planner. */
const WATCH_DAYS = 21;

export interface OutboxMessage {
  messageId: string;
  /** The agent's number, which the device resolves to a Zalo user. Never a renter's. */
  phone: string;
  body: string;
}

export interface PullResult {
  /** Sending stopped by an operator. The device keeps reading replies. */
  paused: boolean;
  outbox: OutboxMessage[];
  /** Agents whose messages the device may forward. Everyone else stays on the device. */
  watch: string[];
}

export async function bridgePull(db: Supa, now: Date): Promise<PullResult> {
  const { data: status } = await db.from('zalo_bridge_status').select('paused').eq('id', 'singleton').maybeSingle();
  const paused = status?.paused === true;

  const since = new Date(now.getTime() - WATCH_DAYS * 86_400_000).toISOString();
  const { data: recent } = await db.from('viewing_requests').select('id').gte('created_at', since);
  const requestIds = ((recent ?? []) as { id: string }[]).map(r => r.id);
  const { data: items } = requestIds.length
    ? await db.from('request_items').select('realtor_id').in('request_id', requestIds)
    : { data: [] };
  // And the building agents asked about an availability request (S7.2).
  const { data: asked } = await db.from('realtor_messages')
    .select('realtor_id').not('inquiry_id', 'is', null).eq('direction', 'OUT').gte('created_at', since);
  const realtorIds = [...new Set([
    ...((items ?? []) as { realtor_id: string | null }[]).map(i => i.realtor_id),
    ...((asked ?? []) as { realtor_id: string | null }[]).map(m => m.realtor_id),
  ].filter(Boolean))];
  const { data: realtors } = realtorIds.length
    ? await db.from('realtors').select('id, phone_e164').in('id', realtorIds)
    : { data: [] };
  const phoneOf = new Map(((realtors ?? []) as { id: string; phone_e164: string }[]).map(r => [r.id, r.phone_e164]));

  const outbox: OutboxMessage[] = [];
  if (!paused) {
    const { data: queued } = await db.from('realtor_messages')
      .select('id, realtor_id, body, claimed_at')
      .eq('direction', 'OUT').eq('status', 'QUEUED')
      .order('created_at', { ascending: true }).limit(PULL_LIMIT * 3);
    const leaseEdge = now.getTime() - CLAIM_LEASE_MS;
    for (const m of (queued ?? []) as { id: string; realtor_id: string | null; body: string; claimed_at: string | null }[]) {
      if (outbox.length >= PULL_LIMIT) break;
      if (m.claimed_at && Date.parse(m.claimed_at) > leaseEdge) continue;
      let phone = m.realtor_id ? phoneOf.get(m.realtor_id) : undefined;
      if (!phone && m.realtor_id) {
        const { data: r } = await db.from('realtors').select('phone_e164').eq('id', m.realtor_id).maybeSingle();
        phone = r?.phone_e164;
      }
      if (!phone) {
        // Nothing the device could do with it. Failed here, visibly, rather
        // than handed out to fail on the device.
        await db.from('realtor_messages').update({ status: 'FAILED', error: 'No agent number to send to.' }).eq('id', m.id);
        continue;
      }
      await db.from('realtor_messages').update({ claimed_at: now.toISOString() }).eq('id', m.id);
      outbox.push({ messageId: m.id, phone, body: m.body });
    }
  }

  return { paused, outbox, watch: [...new Set(phoneOf.values())] };
}

export type AckResult = { ok: true; eventWritten: boolean } | { ok: false; error: string };

/** The device's report on one message. Safe to repeat: a second SENT ack writes nothing. */
export async function bridgeAck(
  db: Supa,
  ack: { messageId: string; sent: boolean; providerId?: string; error?: string },
  now: Date,
): Promise<AckResult> {
  const { data: m } = await db.from('realtor_messages')
    .select('id, status, direction, on_sent_event, inquiry_id').eq('id', ack.messageId).maybeSingle();
  if (!m || m.direction !== 'OUT') return { ok: false, error: 'Unknown message' };
  if (m.status === 'SENT') return { ok: true, eventWritten: false };

  if (!ack.sent) {
    await db.from('realtor_messages').update({
      status: 'FAILED', error: String(ack.error ?? 'The device could not send it.').slice(0, 500), claimed_at: null,
    }).eq('id', m.id);
    return { ok: true, eventWritten: false };
  }

  await db.from('realtor_messages').update({
    status: 'SENT', sent_at: now.toISOString(), provider_id: ack.providerId ?? null,
  }).eq('id', m.id);

  const event = m.on_sent_event as Record<string, unknown> | null;
  if (!event) return { ok: true, eventWritten: false };
  // An availability check's AGENT_ASKED goes in that request's own log.
  const { error } = await db.from(m.inquiry_id ? 'inquiry_events' : 'events').insert({ ...event, occurred_at: now.toISOString() });
  if (error) {
    console.error('[bridge] event after send failed:', error);
    return { ok: false, error: 'event_failed' };
  }
  return { ok: true, eventWritten: true };
}

export type InboundResult =
  | { stored: true; requestId: string; itemId: string; messageId: string }
  | { stored: true; inquiryId: string; messageId: string }
  | { stored: false; reason: string };

/**
 * A message from an agent, as the device saw it. Attributed to what we most
 * recently sent that agent something about - an item of a viewing request, or
 * an availability request - since an agent answers the last thing they were
 * asked. Anyone who is not a known agent is dropped unstored.
 */
export async function bridgeInbound(
  db: Supa,
  m: { fromPhone: string; text: string; providerMessageId: string },
): Promise<InboundResult> {
  const phone = toE164(m.fromPhone);
  if (!phone) return { stored: false, reason: 'not a Vietnamese mobile number' };
  const text = String(m.text ?? '').trim();
  if (!text) return { stored: false, reason: 'empty' };

  const { data: realtor } = await db.from('realtors').select('id').eq('phone_e164', phone).maybeSingle();
  if (!realtor) return { stored: false, reason: 'not a known agent' };

  const { data: last } = await db.from('realtor_messages')
    .select('request_id, item_id, inquiry_id').eq('realtor_id', realtor.id).eq('direction', 'OUT').eq('status', 'SENT')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();

  // The last thing we asked them was what is free at a building (S7.2).
  if (last?.inquiry_id) {
    const reply = await recordRealtorReply(new SupabaseRealtorMessageStore(db), {
      inquiryId: String(last.inquiry_id),
      realtorId: realtor.id,
      medium: 'ZALO',
      body: text.slice(0, 4000),
      actor: 'BRIDGE',
      idempotencyKey: `bridge:${m.providerMessageId}`,
    });
    return { stored: true, inquiryId: String(last.inquiry_id), messageId: reply.id };
  }

  let target = last?.item_id ? { requestId: String(last.request_id), itemId: String(last.item_id) } : null;
  if (!target) {
    const { data: item } = await db.from('request_items')
      .select('id, request_id').eq('realtor_id', realtor.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (item) target = { requestId: String(item.request_id), itemId: String(item.id) };
  }
  if (!target) return { stored: false, reason: 'no request for this agent' };

  const reply = await recordRealtorReply(new SupabaseRealtorMessageStore(db), {
    requestId: target.requestId,
    itemId: target.itemId,
    realtorId: realtor.id,
    medium: 'ZALO',
    body: text.slice(0, 4000),
    actor: 'BRIDGE',
    idempotencyKey: `bridge:${m.providerMessageId}`,
  });
  return { stored: true, ...target, messageId: reply.id };
}

export async function bridgeHeartbeat(
  db: Supa,
  h: { device?: string; version?: string; sentToday?: number; error?: string | null },
  now: Date,
): Promise<void> {
  await db.from('zalo_bridge_status').update({
    last_seen_at: now.toISOString(),
    device: h.device ? String(h.device).slice(0, 80) : null,
    version: h.version ? String(h.version).slice(0, 40) : null,
    sent_today: Number.isInteger(h.sentToday) ? h.sentToday : 0,
    last_error: h.error ? String(h.error).slice(0, 500) : null,
    updated_at: now.toISOString(),
  }).eq('id', 'singleton');
}
