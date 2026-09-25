// Every action an operator can take, as typed calls over the event log.
//
// `ops-record-outcome` is the HTTP door: it proves the caller is ops and hands
// the body here. The logic lives in `_shared` rather than in that function for
// two reasons. It is tested against the in-memory FakeDb like the rest of the
// flow. And it is the tool list for the AI operator (AI operator plan,
// component 1): the agent will call these same actions with an
// `AGENT:<version>` actor, and there must be one implementation of "record an
// outcome", not a human one and a machine one drifting apart.
//
// Nothing here writes a status. Each action writes typed events (invariant 1),
// outcomes come from the closed set of seven (invariant 2), and every message
// is persisted before it counts as sent (invariant 3).
//
// Item actions - the broker side:
//   CONTACTED       first message to the broker, with the words sent
//   NUDGE           chasing a silent broker
//   REALTOR_REPLY   what the broker said, stored before anyone reads it
//   OUTCOME         one of the seven, optionally with the reply it came from
//   RECORD_CONTACT  a working number the operator found
//   NOTIFY_REALTOR  telling the broker the renter's decision
//
// Request actions - the renter side:
//   REPLY           a free-text answer on WhatsApp, inside the 24h window
//   ACK_REPLIES     the renter's replies were read and need no answer

import {
  reduceRequest,
  REALTOR_DECISIONS,
  type DomainEvent,
  type RealtorDecision,
} from '../viewing-domain.ts';
import { validateOutcome, outcomePayload, jobsForOutcome } from './outcomes.ts';
import { realtorDecisionsOwed } from './reminders.ts';
import { waitingReplies, checkOperatorReply } from './thread.ts';
import {
  sendFreeForm,
  ServiceWindowClosedError,
  ConsecutiveMessageError,
  type MessageStore,
} from '../whatsapp/send.ts';
import type { WhatsAppAdapter } from '../whatsapp/adapter.ts';
import { toE164 } from '../whatsapp/inbound.ts';
import { REALTOR_MEDIA, type RealtorChannel, type RealtorMedium } from '../realtor/channel.ts';
import {
  sendToRealtor,
  recordRealtorReply,
  RenterIdentityError,
  type RealtorMessageStore,
  type RealtorPurpose,
} from '../realtor/send.ts';

// deno-lint-ignore no-explicit-any
type Supa = any;

export interface OpsDeps {
  whatsapp: WhatsAppAdapter;
  messages: MessageStore;
  realtorChannel: RealtorChannel;
  realtorMessages: RealtorMessageStore;
  /** Idempotency keys the caller did not supply. Injected so tests are stable. */
  newKey?: () => string;
}

export interface OpsResult {
  status: number;
  body: Record<string, unknown>;
}

const done = (body: Record<string, unknown>): OpsResult => ({ status: 200, body: { success: true, ...body } });
const refuse = (status: number, error: string, message?: string): OpsResult =>
  ({ status, body: { error, ...(message ? { message } : {}) } });

export const ITEM_ACTIONS = ['CONTACTED', 'NUDGE', 'REALTOR_REPLY', 'OUTCOME', 'RECORD_CONTACT', 'NOTIFY_REALTOR'] as const;
export const REQUEST_ACTIONS = ['REPLY', 'ACK_REPLIES'] as const;

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function parseMedium(v: unknown): RealtorMedium | null {
  const m = str(v).toUpperCase() || 'ZALO';
  return (REALTOR_MEDIA as readonly string[]).includes(m) ? m as RealtorMedium : null;
}

/** A caller-supplied idempotency key: what makes a double-click one message. */
function clientKey(v: unknown): string | null {
  const k = str(v);
  return /^[A-Za-z0-9-]{8,64}$/.test(k) ? k : null;
}

async function loadEvents(db: Supa, requestId: string): Promise<DomainEvent[]> {
  const { data } = await db
    .from('events')
    .select('id, request_id, item_id, type, payload, actor, occurred_at')
    .eq('request_id', requestId)
    .order('occurred_at', { ascending: true });
  return (data ?? []) as DomainEvent[];
}

/** How many of one event an item already has. A fact about the log, never the caller's claim. */
async function countItemEvents(db: Supa, itemId: string, type: string): Promise<number> {
  const { data } = await db.from('events').select('id').eq('item_id', itemId).eq('type', type);
  return (data ?? []).length;
}

/**
 * The renter behind a request, read with the service role for one purpose:
 * checking a broker-bound message does not carry them. Never returned.
 */
async function loadRenter(db: Supa, requestId: string) {
  const { data: req } = await db.from('viewing_requests').select('renter_id').eq('id', requestId).maybeSingle();
  if (!req?.renter_id) return null;
  const { data } = await db
    .from('renters').select('id, phone_e164, display_name').eq('id', req.renter_id).maybeSingle();
  return (data as { id: string; phone_e164: string; display_name: string | null } | null) ?? null;
}

/**
 * Clear the to-dos an action fulfils. After the event, never instead of it: a
 * job left open is a stale line in the console, a missing event is lost work.
 */
async function completeJobs(db: Supa, kinds: string[], itemId: string): Promise<void> {
  for (const kind of kinds) {
    await db.from('jobs')
      .update({ completed_at: new Date().toISOString() })
      .eq('kind', kind)
      .is('completed_at', null)
      .eq('payload->>item_id', itemId);
  }
}

async function insertEvent(db: Supa, row: Record<string, unknown>): Promise<OpsResult | null> {
  const { error } = await db.from('events').insert(row);
  if (error) {
    console.error('[ops-actions] event insert failed:', error);
    return refuse(500, 'event_failed');
  }
  return null;
}

interface Item {
  id: string;
  request_id: string;
  listing_id: string;
  realtor_id: string | null;
}

/** Send to the broker, turning the send layer's refusals into answers. */
async function toRealtor(
  db: Supa,
  deps: OpsDeps,
  item: Item,
  actor: string,
  opts: { purpose: Exclude<RealtorPurpose, 'REPLY'>; medium: RealtorMedium; body: string; key: string },
): Promise<{ id: string } | OpsResult> {
  try {
    const sent = await sendToRealtor(deps.realtorMessages, deps.realtorChannel, {
      requestId: item.request_id,
      itemId: item.id,
      realtorId: item.realtor_id,
      medium: opts.medium,
      purpose: opts.purpose,
      body: opts.body,
      actor,
      idempotencyKey: opts.key,
      renter: (await loadRenter(db, item.request_id)) ?? undefined,
    });
    if (sent.message.status === 'FAILED') return refuse(502, 'send_failed');
    return { id: sent.message.id };
  } catch (e) {
    if (e instanceof RenterIdentityError) return refuse(400, 'renter_identity', e.message);
    return refuse(400, 'invalid_message', (e as Error).message);
  }
}

export async function performOpsAction(
  db: Supa,
  deps: OpsDeps,
  actor: string,
  input: Record<string, unknown>,
): Promise<OpsResult> {
  const action = str(input.action) || 'OUTCOME';
  if ((REQUEST_ACTIONS as readonly string[]).includes(action)) return requestAction(db, deps, actor, action, input);
  if (!(ITEM_ACTIONS as readonly string[]).includes(action)) return refuse(400, `Unknown action: ${action}`);

  const itemId = str(input.itemId);
  if (!itemId) return refuse(400, 'itemId is required');

  // The item names its own request; taking the request id from the caller
  // would let a mistyped body file an event against someone else's request.
  const { data: item } = await db
    .from('request_items').select('id, request_id, listing_id, realtor_id').eq('id', itemId).maybeSingle();
  if (!item) return refuse(404, 'Unknown item');

  const medium = parseMedium(input.channel);
  if (!medium) return refuse(400, 'invalid_channel', `channel must be one of ${REALTOR_MEDIA.join(', ')}`);
  const newKey = deps.newKey ?? (() => crypto.randomUUID());

  switch (action) {
    case 'CONTACTED': {
      // The words are optional so a broker reached by phone can still be
      // marked, but the console always sends them - they are the transcript.
      const text = str(input.message);
      let messageId: string | null = null;
      if (text) {
        const attempt = (await countItemEvents(db, item.id, 'REALTOR_CONTACTED')) + 1;
        const sent = await toRealtor(db, deps, item, actor, {
          purpose: 'REQUEST_VIEWING', medium, body: text, key: `${item.id}:REQUEST_VIEWING:${attempt}`,
        });
        if (!('id' in sent)) return sent;
        messageId = sent.id;
      }
      const failed = await insertEvent(db, {
        request_id: item.request_id,
        item_id: item.id,
        type: 'REALTOR_CONTACTED',
        payload: { channel: medium, draft_id: messageId },
        actor,
      });
      return failed ?? done({ recorded: 'REALTOR_CONTACTED', messageId });
    }

    case 'NUDGE': {
      const attempt = (await countItemEvents(db, item.id, 'ITEM_NUDGED')) + 1;
      const text = str(input.message);
      let messageId: string | null = null;
      if (text) {
        const sent = await toRealtor(db, deps, item, actor, {
          purpose: 'NUDGE', medium, body: text, key: `${item.id}:NUDGE:${attempt}`,
        });
        if (!('id' in sent)) return sent;
        messageId = sent.id;
      }
      const failed = await insertEvent(db, {
        request_id: item.request_id,
        item_id: item.id,
        type: 'ITEM_NUDGED',
        payload: { attempt, ...(messageId ? { message_id: messageId } : {}) },
        actor,
      });
      if (failed) return failed;
      // The scheduler enqueues NUDGE_REALTOR as a to-do because the realtor
      // channel is a person on Zalo, not an API. An operator actually doing it
      // is what completes the job - nothing else ever will.
      await completeJobs(db, ['NUDGE_REALTOR'], item.id);
      return done({ recorded: 'ITEM_NUDGED', attempt, messageId });
    }

    case 'REALTOR_REPLY': {
      // A reply that does not settle anything yet ("let me check with the
      // owner"). Stored, never parsed, moves nothing.
      const text = str(input.message);
      if (!text) return refuse(400, 'invalid_message', 'The reply is empty.');
      try {
        const reply = await recordRealtorReply(deps.realtorMessages, {
          requestId: item.request_id, itemId: item.id, realtorId: item.realtor_id, medium, body: text, actor,
          idempotencyKey: `${item.id}:REPLY:${clientKey(input.clientKey) ?? newKey()}`,
        });
        return done({ recorded: 'REALTOR_REPLY', messageId: reply.id });
      } catch (e) {
        return refuse(400, 'invalid_message', (e as Error).message);
      }
    }

    case 'OUTCOME': {
      // The nudge count is read here and passed into a pure check rather than
      // trusted from the caller: NO_RESPONSE is the one outcome whose
      // legitimacy depends on what already happened.
      const priorNudges = await countItemEvents(db, item.id, 'ITEM_NUDGED');
      const validated = validateOutcome(
        { outcome: str(input.outcome), slots: input.slots, actualPriceVnd: input.actualPriceVnd, note: input.note },
        { priorNudges },
      );
      if (!validated.ok) return refuse(400, 'invalid_outcome', validated.error);

      // The broker's words, stored beside the outcome an operator read in
      // them. That pair is the training corpus; the note is not part of it.
      let replyId: string | null = null;
      const replyText = str(input.realtorReply);
      if (replyText) {
        try {
          const reply = await recordRealtorReply(deps.realtorMessages, {
            requestId: item.request_id, itemId: item.id, realtorId: item.realtor_id, medium, body: replyText, actor,
            idempotencyKey: `${item.id}:REPLY:${clientKey(input.clientKey) ?? newKey()}`,
          });
          replyId = reply.id;
        } catch (e) {
          return refuse(400, 'invalid_message', (e as Error).message);
        }
      }

      const failed = await insertEvent(db, {
        request_id: item.request_id,
        item_id: item.id,
        type: 'OUTCOME_RECORDED',
        payload: { ...outcomePayload(validated.value), ...(replyId ? { reply_message_id: replyId } : {}) },
        actor,
      });
      if (failed) return failed;

      // Follow-on work, after the event rather than instead of it. A failure
      // here must not lose the outcome.
      const jobs = jobsForOutcome(validated.value, {
        itemId: item.id, listingId: item.listing_id, requestId: item.request_id,
      });
      if (jobs.length > 0) {
        const { error: jobErr } = await db.from('jobs').insert(jobs);
        if (jobErr) console.error('[ops-actions] job enqueue failed:', jobErr);
      }
      return done({ recorded: 'OUTCOME_RECORDED', outcome: validated.value.outcome, replyMessageId: replyId });
    }

    case 'RECORD_CONTACT':
      return recordContact(db, item, actor, input);

    case 'NOTIFY_REALTOR': {
      const decision = str(input.decision).toUpperCase() as RealtorDecision;
      if (!(REALTOR_DECISIONS as readonly string[]).includes(decision)) {
        return refuse(400, 'invalid_decision', `decision must be one of ${REALTOR_DECISIONS.join(', ')}`);
      }
      // Owed is derived from the log, not asserted by the caller: confirming a
      // broker before the renter has said yes is promising a viewing nobody
      // agreed to, and it would be the operator's word against the log.
      const view = reduceRequest(item.request_id, await loadEvents(db, item.request_id));
      const owed = realtorDecisionsOwed(view).find(o => o.itemId === item.id);
      if (!owed) {
        return refuse(409, 'not_owed', view.items[item.id]?.notified
          ? 'This agent has already been told.'
          : 'Nothing to tell this agent yet - the renter has not decided.');
      }
      if (owed.decision !== decision) {
        return refuse(409, 'wrong_decision', `This agent is owed ${owed.decision}, not ${decision}.`);
      }
      const text = str(input.message);
      if (!text) return refuse(400, 'invalid_message', 'Send the agent the message, then record it.');
      const sent = await toRealtor(db, deps, item, actor, {
        purpose: decision, medium, body: text, key: `${item.id}:${decision}:1`,
      });
      if (!('id' in sent)) return sent;
      const failed = await insertEvent(db, {
        request_id: item.request_id,
        item_id: item.id,
        type: 'REALTOR_NOTIFIED',
        payload: { decision, message_id: sent.id },
        actor,
      });
      if (failed) return failed;
      await completeJobs(db, [decision === 'CONFIRM' ? 'CONFIRM_REALTOR' : 'RELEASE_REALTOR'], item.id);
      return done({ recorded: 'REALTOR_NOTIFIED', decision, messageId: sent.id });
    }
  }
  return refuse(400, `Unknown action: ${action}`);
}

/**
 * A working number for this item's broker (gap 4 in the AI operator plan).
 *
 * "Find a working number" was a to-do nothing could complete: the console had
 * no way to save what the operator found. One resolution also enriches every
 * future listing from the same broker (SPEC §1) - the listing row and, where
 * the source gave us one, the broker's source identity.
 */
async function recordContact(db: Supa, item: Item, actor: string, input: Record<string, unknown>): Promise<OpsResult> {
  const phone = toE164(str(input.phone));
  if (!phone) return refuse(400, 'invalid_phone', `Not a Vietnamese mobile number: ${str(input.phone) || '(empty)'}`);
  const name = str(input.name).slice(0, 120) || null;

  let { data: realtor } = await db
    .from('realtors').select('id, display_name').eq('phone_e164', phone).maybeSingle();
  if (!realtor) {
    const { data, error } = await db
      .from('realtors').insert({ phone_e164: phone, display_name: name }).select('id, display_name').single();
    if (error?.code === '23505') {
      ({ data: realtor } = await db.from('realtors').select('id, display_name').eq('phone_e164', phone).maybeSingle());
    } else if (error) {
      console.error('[ops-actions] realtor insert failed:', error);
      return refuse(500, 'realtor_failed');
    } else {
      realtor = data;
    }
  } else if (!realtor.display_name && name) {
    await db.from('realtors').update({ display_name: name, updated_at: new Date().toISOString() }).eq('id', realtor.id);
  }
  if (!realtor) return refuse(500, 'realtor_failed');

  // A reference, not a status: which broker this item is worked through. The
  // event below is what the log remembers; this is what the view joins on.
  await db.from('request_items').update({ realtor_id: realtor.id }).eq('id', item.id);

  const failed = await insertEvent(db, {
    request_id: item.request_id,
    item_id: item.id,
    type: 'REALTOR_RESOLVED',
    payload: { realtor_id: realtor.id, method: 'MANUAL' },
    actor,
  });
  if (failed) return failed;

  // Enrichment. Best effort: the item has its broker either way, and a failure
  // here costs a future lookup, not this request.
  const { data: listing } = await db
    .from('external_properties').select('source, source_agent_id').eq('id', item.listing_id).maybeSingle();
  await db.from('external_properties').update({ realtor_id: realtor.id }).eq('id', item.listing_id);
  if (listing?.source && listing?.source_agent_id) {
    const { data: identity } = await db
      .from('realtor_identities').select('realtor_id')
      .eq('source', listing.source).eq('source_agent_id', listing.source_agent_id).maybeSingle();
    if (!identity) {
      await db.from('realtor_identities').insert({
        realtor_id: realtor.id, source: listing.source, source_agent_id: listing.source_agent_id,
      });
    } else if (identity.realtor_id !== realtor.id) {
      // Same broker, new number - the old one was the dead end this fixes.
      await db.from('realtor_identities').update({ realtor_id: realtor.id })
        .eq('source', listing.source).eq('source_agent_id', listing.source_agent_id);
    }
  }

  await completeJobs(db, ['RESOLVE_REALTOR'], item.id);
  return done({ recorded: 'REALTOR_RESOLVED', realtorId: realtor.id });
}

async function requestAction(
  db: Supa,
  deps: OpsDeps,
  actor: string,
  action: string,
  input: Record<string, unknown>,
): Promise<OpsResult> {
  const requestId = str(input.requestId);
  if (!requestId) return refuse(400, 'requestId is required');
  const { data: request } = await db
    .from('viewing_requests').select('id, renter_id').eq('id', requestId).maybeSingle();
  if (!request) return refuse(404, 'Unknown request');

  const events = await loadEvents(db, requestId);

  if (action === 'ACK_REPLIES') {
    const waiting = waitingReplies(events);
    if (waiting.length === 0) return refuse(409, 'nothing_waiting', 'No renter replies are waiting.');
    const failed = await insertEvent(db, {
      request_id: requestId,
      type: 'REPLIES_ACKNOWLEDGED',
      payload: { message_ids: waiting.map(w => w.messageId).filter(Boolean) },
      actor,
    });
    return failed ?? done({ recorded: 'REPLIES_ACKNOWLEDGED', count: waiting.length });
  }

  // REPLY. Idempotency on every send: the key is the console's, minted once
  // per composed message, so a double-click or a retry is the same message.
  const key = clientKey(input.clientKey);
  if (!key) return refuse(400, 'clientKey is required', 'Every reply carries an idempotency key.');

  const view = reduceRequest(requestId, events);
  const check = checkOperatorReply(str(input.message), view.state);
  if (!check.ok) return refuse(400, 'invalid_reply', check.error);

  let sent;
  try {
    sent = await sendFreeForm(deps.messages, deps.whatsapp, {
      renterId: request.renter_id,
      requestId,
      purpose: `OPS_REPLY:${key}`,
      body: check.body,
    });
  } catch (e) {
    // All three are the send layer doing its job, not faults: the answer is a
    // template, or waiting for the renter, or nothing at all.
    if (e instanceof ServiceWindowClosedError) {
      return refuse(409, 'window_closed', 'The 24-hour window is closed. The renter has to message first.');
    }
    if (e instanceof ConsecutiveMessageError) {
      return refuse(409, 'too_many_in_a_row', 'Two messages already sent since the renter last wrote. Wait for them.');
    }
    return refuse(409, 'cannot_send', (e as Error).message);
  }
  if (sent.message.status === 'FAILED') return refuse(502, 'send_failed', 'WhatsApp did not take the message.');

  // A retry that found its message already sent may also find its event
  // already written. One event per message.
  const { data: prior } = await db
    .from('events').select('id').eq('request_id', requestId).eq('type', 'REPLY_SENT')
    .eq('payload->>message_id', sent.message.id);
  if ((prior ?? []).length === 0) {
    const failed = await insertEvent(db, {
      request_id: requestId,
      type: 'REPLY_SENT',
      payload: { message_id: sent.message.id },
      actor,
    });
    if (failed) return failed;
  }
  return done({ recorded: 'REPLY_SENT', messageId: sent.message.id, deduplicated: sent.deduplicated });
}
