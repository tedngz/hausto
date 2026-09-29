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
//   CANCEL_REQUEST  the request is over; brokers holding time become owed a release
//   DELIVER         send the itinerary (the same deliver() the console's button uses)
//
// Proposal verdicts - the AI operator's shadow mode (planner.ts):
//   APPROVE_PROPOSAL  run what it proposed, with any rewording, as this operator
//   REJECT_PROPOSAL   decline it, with an optional note

import {
  reduceRequest,
  REALTOR_DECISIONS,
  CANCEL_REASONS,
  type DomainEvent,
  type RealtorDecision,
  type CancelReason,
} from '../viewing-domain.ts';
import { validateOutcome, outcomePayload, jobsForOutcome, OUTCOMES } from './outcomes.ts';
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
import { validateBuildingAgent } from './roster.ts';
import { isInquiryAction, performInquiryAction } from './inquiry-actions.ts';
import { deliver } from './deliver.ts';
import { settlementFor, approvalOf, type ProposalRow, type DoneAction } from './proposals.ts';
import { AUTONOMOUS_ACTIONS } from './autonomy.ts';
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
export const REQUEST_ACTIONS = ['REPLY', 'ACK_REPLIES', 'CANCEL_REQUEST', 'DELIVER'] as const;

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

/**
 * What paste-parse suggested, kept beside what the operator recorded.
 *
 * The pair is the agreement rate the AI operator plan gates on: how often the
 * model's reading matched the operator's. Reduced to the fields that measure
 * it and checked against the closed sets, because it arrives from the browser
 * and lives in an append-only log. The reducer never reads it.
 */
function suggestedPayload(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const outcome = (OUTCOMES as readonly string[]).includes(String(s.outcome)) ? String(s.outcome) : null;
  const slots = Array.isArray(s.slots)
    ? s.slots.slice(0, 6)
      .map(x => String((x as { startsAt?: unknown })?.startsAt ?? ''))
      .filter(t => Number.isFinite(Date.parse(t)))
    : [];
  const price = Number.isInteger(s.actualPriceVnd) ? s.actualPriceVnd : null;
  return {
    outcome,
    slot_starts: slots,
    actual_price_vnd: price,
    confidence: s.confidence === 'HIGH' ? 'HIGH' : 'LOW',
    model: typeof s.model === 'string' ? s.model.slice(0, 60) : null,
  };
}

interface Item {
  id: string;
  request_id: string;
  listing_id: string;
  realtor_id: string | null;
}

interface SentRef { id: string; status: string }

/**
 * Write the event a message to a broker stands for. Now, when it has left
 * (the manual channel: the operator already sent it). On the device's ack,
 * when it is queued for the bridge - the event rides on the message row
 * (`on_sent_event`) until zalo-bridge hears it was sent, so the log never says
 * an agent was contacted by a message still sitting in an outbox.
 */
async function eventForSend(db: Supa, sent: SentRef | null, row: Record<string, unknown>): Promise<OpsResult | null> {
  if (sent?.status === 'QUEUED') {
    const { error } = await db.from('realtor_messages').update({ on_sent_event: row }).eq('id', sent.id);
    if (error) {
      console.error('[ops-actions] deferring the event failed:', error);
      return refuse(500, 'event_failed');
    }
    return null;
  }
  return insertEvent(db, row);
}

/** Send to the broker, turning the send layer's refusals into answers. */
async function toRealtor(
  db: Supa,
  deps: OpsDeps,
  item: Item,
  actor: string,
  opts: { purpose: Exclude<RealtorPurpose, 'REPLY'>; medium: RealtorMedium; body: string; key: string },
): Promise<SentRef | OpsResult> {
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
    return { id: sent.message.id, status: sent.message.status };
  } catch (e) {
    if (e instanceof RenterIdentityError) return refuse(400, 'renter_identity', e.message);
    return refuse(400, 'invalid_message', (e as Error).message);
  }
}

/**
 * Run one action, then score any AI operator proposal it answers.
 *
 * Scoring happens here, beside the action, because this is the one place
 * every operator action passes through: an operator doing the work by hand is
 * the commonest way a proposal is agreed with or corrected, and a proposal
 * left PENDING after the work is done would be a decision the agreement rate
 * never counts. It never affects the action's own result.
 */
export async function performOpsAction(
  db: Supa,
  deps: OpsDeps,
  actor: string,
  input: Record<string, unknown>,
): Promise<OpsResult> {
  const action = str(input.action) || 'OUTCOME';
  if (action === 'APPROVE_PROPOSAL' || action === 'REJECT_PROPOSAL') {
    return decideProposal(db, deps, actor, action, input);
  }
  if (action === 'SET_BRIDGE') {
    // Stops the Zalo device sending, from the console. It keeps reading
    // replies - pausing the outbox is not a reason to lose what agents say.
    if (typeof input.paused !== 'boolean') return refuse(400, 'paused must be true or false');
    const { error } = await db.from('zalo_bridge_status')
      .update({ paused: input.paused, updated_at: new Date().toISOString() }).eq('id', 'singleton');
    if (error) return refuse(500, 'bridge_failed');
    return done({ recorded: input.paused ? 'BRIDGE_PAUSED' : 'BRIDGE_RESUMED' });
  }
  if (action === 'HOLD_PROPOSAL' || action === 'FLAG_PROPOSAL' || action === 'SET_AUTONOMY') {
    return superviseAutonomy(db, actor, action, input);
  }
  // A building's agents (PLAN-v3 S7.0) - about no request, so no proposals to settle.
  if (action === 'ADD_BUILDING_AGENT') return addBuildingAgent(db, actor, input);
  if (action === 'REMOVE_BUILDING_AGENT') return removeBuildingAgent(db, input);
  // Availability requests (PLAN-v3 S7.1) - their own log, no proposals yet.
  if (isInquiryAction(action)) return performInquiryAction(db, deps, actor, action, input);
  const result = await dispatch(db, deps, actor, action, input);
  if (result.status === 200) {
    try {
      await settleProposals(db, { action, itemId: str(input.itemId) || null, input }, actor, str(input.viaProposal) || null);
    } catch (e) {
      console.error('[ops-actions] proposal settlement failed:', (e as Error).message);
    }
  }
  return result;
}

async function settleProposals(db: Supa, done: DoneAction, actor: string, exceptId: string | null): Promise<void> {
  let query = db.from('operator_proposals')
    .select('id, request_id, item_id, dedupe_key, action, input, status')
    .eq('status', 'PENDING');
  query = done.itemId ? query.eq('item_id', done.itemId) : query.eq('request_id', str(done.input.requestId));
  const { data } = await query;
  for (const p of (data ?? []) as ProposalRow[]) {
    if (p.id === exceptId) continue;
    const verdict = settlementFor(p, done);
    if (!verdict) continue;
    const { action: _a, viaProposal: _v, ...executed } = done.input;
    await db.from('operator_proposals').update({
      status: verdict,
      executed_action: done.action,
      executed_input: executed,
      decided_by: operatorId(actor),
      decided_at: new Date().toISOString(),
    }).eq('id', p.id);
  }
}

/** `OPS:<uuid>` to the uuid, or null for a non-person actor. */
function operatorId(actor: string): string | null {
  return actor.startsWith('OPS:') ? actor.slice(4) : null;
}

/**
 * An operator's verdict on one proposal.
 *
 * Approving runs the proposed action - with any rewording the operator made -
 * through the same path as every other action, under the operator's own actor.
 * The AI operator never writes to the log in shadow mode; a person approving
 * its proposal does. ESCALATE runs nothing: approving it agrees that it needed
 * a person.
 */
async function decideProposal(
  db: Supa,
  deps: OpsDeps,
  actor: string,
  action: string,
  input: Record<string, unknown>,
): Promise<OpsResult> {
  const id = str(input.proposalId);
  if (!id) return refuse(400, 'proposalId is required');
  const { data: p } = await db
    .from('operator_proposals')
    .select('id, request_id, item_id, dedupe_key, action, input, status')
    .eq('id', id)
    .maybeSingle();
  if (!p) return refuse(404, 'Unknown proposal');
  if (p.status !== 'PENDING') return refuse(409, 'already_decided', `This proposal is already ${String(p.status).toLowerCase()}.`);

  const decided = { decided_by: operatorId(actor), decided_at: new Date().toISOString() };

  if (action === 'REJECT_PROPOSAL') {
    await db.from('operator_proposals').update({
      status: 'REJECTED', ...decided, decision_note: str(input.note).slice(0, 2000) || null,
    }).eq('id', id);
    return done({ recorded: 'PROPOSAL_REJECTED' });
  }

  if (p.action === 'ESCALATE') {
    await db.from('operator_proposals').update({ status: 'APPROVED', ...decided }).eq('id', id);
    return done({ recorded: 'PROPOSAL_APPROVED' });
  }

  const overrides = (input.overrides && typeof input.overrides === 'object' ? input.overrides : {}) as Record<string, unknown>;
  const approval = approvalOf(p.input as Record<string, unknown>, overrides);
  const result = await performOpsAction(db, deps, actor, { ...approval.input, action: p.action, viaProposal: id });
  if (result.status !== 200) return result;

  await db.from('operator_proposals').update({
    status: approval.status,
    edited: approval.edited,
    executed_action: p.action,
    executed_input: approval.input,
    ...decided,
  }).eq('id', id);
  return { ...result, body: { ...result.body, proposal: approval.status } };
}

/**
 * A person supervising the AI operator's own actions (stage 2).
 *
 *   HOLD_PROPOSAL  take over one it was about to run: it stops being
 *                  automatic and waits for a person like any other.
 *   FLAG_PROPOSAL  mark one it already ran as wrong. A WhatsApp message cannot
 *                  be unsent; the flag is what tells someone to follow up, and
 *                  what closes the gate if it happens too often (autonomy.ts).
 *   SET_AUTONOMY   pause or resume all of it - the switch any operator can
 *                  reach without the dashboard.
 */
async function superviseAutonomy(
  db: Supa,
  actor: string,
  action: string,
  input: Record<string, unknown>,
): Promise<OpsResult> {
  const now = new Date().toISOString();

  if (action === 'SET_AUTONOMY') {
    // Either lock an operator holds: the pause, or the gate override (which
    // actions skip the measured gate). Setting the override to [] restores it.
    const patch: Record<string, unknown> = {};
    if (typeof input.paused === 'boolean') patch.paused = input.paused;
    if (Array.isArray(input.gateOverride)) {
      const list = input.gateOverride.map(a => String(a).toUpperCase());
      if (list.some(a => !(AUTONOMOUS_ACTIONS as readonly string[]).includes(a))) {
        return refuse(400, 'invalid_override', `gateOverride may only name ${AUTONOMOUS_ACTIONS.join(', ')}`);
      }
      patch.gate_override = [...new Set(list)];
    }
    if (Object.keys(patch).length === 0) return refuse(400, 'Give paused (true/false) or gateOverride (a list).');
    const { error } = await db.from('ai_operator_controls').update({
      ...patch, note: str(input.note).slice(0, 500) || null,
      updated_by: operatorId(actor), updated_at: now,
    }).eq('id', 'singleton');
    if (error) return refuse(500, 'controls_failed');
    return done({ recorded: 'AUTONOMY_SET', ...patch });
  }

  const id = str(input.proposalId);
  if (!id) return refuse(400, 'proposalId is required');
  const { data: p } = await db.from('operator_proposals').select('id, status, execute_after').eq('id', id).maybeSingle();
  if (!p) return refuse(404, 'Unknown proposal');

  if (action === 'HOLD_PROPOSAL') {
    if (p.status !== 'PENDING') return refuse(409, 'already_decided', `This proposal is already ${String(p.status).toLowerCase()}.`);
    await db.from('operator_proposals').update({ execute_after: null }).eq('id', id);
    return done({ recorded: 'PROPOSAL_HELD' });
  }

  // FLAG_PROPOSAL
  if (p.status !== 'EXECUTED') return refuse(409, 'not_executed', 'Only something the AI operator did itself can be flagged.');
  await db.from('operator_proposals').update({
    status: 'FLAGGED', decided_by: operatorId(actor), decided_at: now,
    decision_note: str(input.note).slice(0, 2000) || null,
  }).eq('id', id);
  return done({ recorded: 'PROPOSAL_FLAGGED' });
}

async function dispatch(
  db: Supa,
  deps: OpsDeps,
  actor: string,
  action: string,
  input: Record<string, unknown>,
): Promise<OpsResult> {
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
      let sent: SentRef | null = null;
      if (text) {
        const attempt = (await countItemEvents(db, item.id, 'REALTOR_CONTACTED')) + 1;
        const r = await toRealtor(db, deps, item, actor, {
          purpose: 'REQUEST_VIEWING', medium, body: text, key: `${item.id}:REQUEST_VIEWING:${attempt}`,
        });
        if (!('id' in r)) return r;
        sent = r;
      }
      const messageId = sent?.id ?? null;
      const failed = await eventForSend(db, sent, {
        request_id: item.request_id,
        item_id: item.id,
        type: 'REALTOR_CONTACTED',
        payload: { channel: medium, draft_id: messageId },
        actor,
      });
      return failed ?? done({ recorded: 'REALTOR_CONTACTED', messageId, queued: sent?.status === 'QUEUED' });
    }

    case 'NUDGE': {
      const attempt = (await countItemEvents(db, item.id, 'ITEM_NUDGED')) + 1;
      const text = str(input.message);
      let sent: SentRef | null = null;
      if (text) {
        const r = await toRealtor(db, deps, item, actor, {
          purpose: 'NUDGE', medium, body: text, key: `${item.id}:NUDGE:${attempt}`,
        });
        if (!('id' in r)) return r;
        sent = r;
      }
      const messageId = sent?.id ?? null;
      const failed = await eventForSend(db, sent, {
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
      return done({ recorded: 'ITEM_NUDGED', attempt, messageId, queued: sent?.status === 'QUEUED' });
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

      const suggested = suggestedPayload(input.suggested);
      const failed = await insertEvent(db, {
        request_id: item.request_id,
        item_id: item.id,
        type: 'OUTCOME_RECORDED',
        payload: {
          ...outcomePayload(validated.value),
          ...(replyId ? { reply_message_id: replyId } : {}),
          ...(suggested ? { suggested } : {}),
        },
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
      const failed = await eventForSend(db, sent, {
        request_id: item.request_id,
        item_id: item.id,
        type: 'REALTOR_NOTIFIED',
        payload: { decision, message_id: sent.id },
        actor,
      });
      if (failed) return failed;
      await completeJobs(db, [decision === 'CONFIRM' ? 'CONFIRM_REALTOR' : 'RELEASE_REALTOR'], item.id);
      return done({ recorded: 'REALTOR_NOTIFIED', decision, messageId: sent.id, queued: sent.status === 'QUEUED' });
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
/**
 * The agent with this number, created if new. A name or agency fills a blank,
 * never overwrites one - the first operator to learn it is as likely right as
 * the second. Shared by RECORD_CONTACT and ADD_BUILDING_AGENT.
 */
async function upsertRealtor(
  db: Supa,
  phone: string,
  name: string | null,
  agency: string | null = null,
): Promise<{ id: string } | null> {
  let { data: realtor } = await db
    .from('realtors').select('id, display_name, agency').eq('phone_e164', phone).maybeSingle();
  if (!realtor) {
    const { data, error } = await db
      .from('realtors').insert({ phone_e164: phone, display_name: name, agency })
      .select('id, display_name, agency').single();
    if (error?.code === '23505') {
      ({ data: realtor } = await db.from('realtors').select('id, display_name, agency').eq('phone_e164', phone).maybeSingle());
    } else if (error) {
      console.error('[ops-actions] realtor insert failed:', error);
      return null;
    } else {
      realtor = data;
    }
  } else {
    const patch: Record<string, unknown> = {};
    if (!realtor.display_name && name) patch.display_name = name;
    if (!realtor.agency && agency) patch.agency = agency;
    if (Object.keys(patch).length) {
      await db.from('realtors').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', realtor.id);
    }
  }
  return realtor ? { id: String(realtor.id) } : null;
}

/**
 * An agent for a building (PLAN-v3 S7.0). Not an event: a roster entry is a
 * contact, not a state of any request, and removing one is allowed.
 * Re-adding the same agent updates the source and note rather than failing.
 */
async function addBuildingAgent(db: Supa, actor: string, input: Record<string, unknown>): Promise<OpsResult> {
  const v = validateBuildingAgent(input);
  if (!v.ok) return refuse(400, v.error, v.message);
  const { complexId, phone, name, agency, source, note } = v.value;

  const { data: complex } = await db.from('complexes').select('id').eq('id', complexId).maybeSingle();
  if (!complex) return refuse(404, 'invalid_complex', 'Unknown building.');

  const realtor = await upsertRealtor(db, phone, name, agency);
  if (!realtor) return refuse(500, 'realtor_failed');

  const { error } = await db.from('complex_agents').upsert(
    { complex_id: complexId, realtor_id: realtor.id, source, note, added_by: actor },
    { onConflict: 'complex_id,realtor_id' },
  );
  if (error) {
    console.error('[ops-actions] roster insert failed:', error);
    return refuse(500, 'roster_failed');
  }
  return done({ recorded: 'BUILDING_AGENT_ADDED', realtorId: realtor.id });
}

/** Take an added agent off a building. Agents found from listings are not stored, so not removable. */
async function removeBuildingAgent(db: Supa, input: Record<string, unknown>): Promise<OpsResult> {
  const complexId = str(input.complexId);
  const realtorId = str(input.realtorId);
  if (!complexId || !realtorId) return refuse(400, 'complexId and realtorId are required');
  const { error } = await db.from('complex_agents').delete().eq('complex_id', complexId).eq('realtor_id', realtorId);
  if (error) return refuse(500, 'roster_failed');
  return done({ recorded: 'BUILDING_AGENT_REMOVED' });
}

async function recordContact(db: Supa, item: Item, actor: string, input: Record<string, unknown>): Promise<OpsResult> {
  const phone = toE164(str(input.phone));
  if (!phone) return refuse(400, 'invalid_phone', `Not a Vietnamese mobile number: ${str(input.phone) || '(empty)'}`);
  const name = str(input.name).slice(0, 120) || null;

  const realtor = await upsertRealtor(db, phone, name);
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

  if (action === 'DELIVER') {
    // The itinerary, as a typed action like every other. The ops console has
    // its own button on viewing-deliver; this is the same deliver() for the
    // AI operator's proposals, so "send the plan" is one tool rather than an
    // HTTP hop only a browser can make.
    const order = Array.isArray(input.order) ? input.order.map(String) : undefined;
    const r = await deliver(db, deps.whatsapp, { requestId, purpose: 'ITINERARY', order, actor });
    if (!r.ok) {
      const status = r.code === 'unknown_request' ? 404 : r.code === 'send_failed' ? 502 : 409;
      return refuse(status, r.code, r.message);
    }
    return done({ recorded: 'ITINERARY_DELIVERED', messageId: r.messageId, stops: r.stops, deduplicated: r.deduplicated });
  }

  if (action === 'CANCEL_REQUEST') {
    // Gap 9: a renter who pulled out stayed in the queue for ever. Cancelling
    // is an event like everything else; the reducer lets it win over any
    // other state, and every broker still holding time becomes owed a release
    // (realtorDecisionsOwed), which is the half of cancelling that matters to
    // them.
    //
    // It refunds nothing. Credits were spent at intake for an operator's time,
    // and whether a cancellation returns them is a payments decision
    // (CLAUDE.md: no new payment surface for the viewing flow).
    const reason = str(input.reason).toUpperCase() as CancelReason;
    if (!(CANCEL_REASONS as readonly string[]).includes(reason)) {
      return refuse(400, 'invalid_reason', `reason must be one of ${CANCEL_REASONS.join(', ')}`);
    }
    if (reduceRequest(requestId, events).state === 'CANCELLED') {
      return refuse(409, 'already_cancelled', 'This request is already cancelled.');
    }
    const note = str(input.note).slice(0, 2000);
    const failed = await insertEvent(db, {
      request_id: requestId,
      type: 'REQUEST_CANCELLED',
      payload: { reason, ...(note ? { note } : {}) },
      actor,
    });
    if (failed) return failed;
    // A confirmation still queued for a request that no longer exists would
    // tell a broker to expect someone. The drain queues releases instead.
    const { data: items } = await db.from('request_items').select('id').eq('request_id', requestId);
    for (const it of (items ?? []) as { id: string }[]) {
      await completeJobs(db, ['CONFIRM_REALTOR', 'NUDGE_REALTOR', 'RESOLVE_REALTOR'], it.id);
    }
    return done({ recorded: 'REQUEST_CANCELLED', reason });
  }

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
