// The operator's steps on an availability request (SPEC §11, PLAN-v3 S7.1).
//
// Reached only through `performOpsAction` (invariant 10), so a person in the
// ops console and, later, the AI operator do exactly the same thing. Each step
// is a typed `inquiry_events` row (invariants 1 and 2); the reply is a message
// on the request's thread, checked like any operator reply to a renter.
//
// Agents are asked on Zalo with the words recorded - through the bridge when
// REALTOR_CHANNEL=bridge, by hand otherwise (S7.2) - or by phone, when the step
// only records that it happened.

import type { WhatsAppAdapter } from '../whatsapp/adapter.ts';
import {
  ConsecutiveMessageError,
  ServiceWindowClosedError,
  UnapprovedTemplateError,
  isWindowOpen,
  sendTemplate,
  type MessageStore,
} from '../whatsapp/send.ts';
import { TEMPLATES } from '../whatsapp/templates.ts';
import { districtLabel, placeOf } from './place.ts';
import type { RealtorChannel } from '../realtor/channel.ts';
import {
  RenterIdentityError,
  assertNoRenterIdentity,
  sendToRealtor,
  type RealtorMessageStore,
} from '../realtor/send.ts';
import { loadOutreach, outreachRefusal } from '../realtor/outreach.ts';
import { upsertRealtor } from '../realtor/store.ts';
import { toE164 } from '../whatsapp/inbound.ts';
import { MAX_AGENT_NAME } from './roster.ts';
import {
  AGENT_ANSWERS,
  INQUIRY_ASK_MEDIA,
  INQUIRY_CLOSE_REASONS,
  reduceInquiry,
  type InquiryEvent,
  type InquiryEventType,
  type InquiryView,
} from '../viewing-domain.ts';
import { checkOperatorReply } from './thread.ts';
import { NoWhatsAppError, recordInquiryMessage, sendConciergeWhatsApp } from './concierge.ts';
import { screenCandidates, type ShortlistCandidate } from './intake.ts';
import { hasPassCover } from './lock-in-run.ts';
import {
  CONCIERGE_SOURCE,
  MAX_COMBINED_UNITS,
  MAX_OFFER_UNITS,
  UNIT_FRESH_DAYS,
  briefOf,
  misfit,
  renderOfferSections,
  type OfferSection,
  unitPhotoPath,
  unitRow,
  unitStale,
  validateBriefChange,
  validateUnit,
} from './offer.ts';

// deno-lint-ignore no-explicit-any
type Supa = any;

export const INQUIRY_ACTIONS = [
  'INQUIRY_ASK_AGENT',
  'INQUIRY_AGENT_ANSWERED',
  'INQUIRY_CAPTURE_UNIT',
  'INQUIRY_RECONFIRM_UNIT',
  'INQUIRY_OFFER_UNITS',
  'INQUIRY_CHANGE_BRIEF',
  'INQUIRY_SEND_UPDATE',
  'INQUIRY_REPLY',
  'INQUIRY_CLOSE',
  'INQUIRY_REOPEN',
] as const;
export type InquiryAction = typeof INQUIRY_ACTIONS[number];

export function isInquiryAction(action: string): action is InquiryAction {
  return (INQUIRY_ACTIONS as readonly string[]).includes(action);
}

export interface InquiryResult {
  status: number;
  body: Record<string, unknown>;
}

const done = (body: Record<string, unknown>): InquiryResult => ({ status: 200, body: { success: true, ...body } });
const refuse = (status: number, error: string, message?: string): InquiryResult =>
  ({ status, body: { error, ...(message ? { message } : {}) } });

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const MAX_NOTE = 500;

interface InquiryRow {
  id: string;
  channel: string;
  whatsapp_confirmed_at: string | null;
  /** Null for an area (Priority search): its districts are below. */
  complex_id: string | null;
  area_district_codes: string[] | null;
  area_label: string | null;
  full_name: string | null;
  renter_id: string | null;
  /** The account that asked, when signed in - every request since 2026-10-07. */
  user_id: string | null;
  watch_id: string | null;
  bedrooms_needed: number;
  budget_max_vnd: number | null;
}

/** The request and its derived state, or a refusal. */
async function load(db: Supa, inquiryId: string): Promise<
  { ok: true; view: InquiryView; row: InquiryRow } |
  { ok: false; result: InquiryResult }
> {
  if (!/^[0-9a-f-]{36}$/i.test(inquiryId)) return { ok: false, result: refuse(400, 'inquiryId is required') };
  const { data: row } = await db
    .from('complex_inquiries')
    .select('id, channel, whatsapp_confirmed_at, complex_id, area_district_codes, area_label, full_name, renter_id, user_id, watch_id, bedrooms_needed, budget_max_vnd')
    .eq('id', inquiryId).maybeSingle();
  if (!row) return { ok: false, result: refuse(404, 'not_found', 'No such request.') };
  if (row.channel !== 'WHATSAPP') {
    return { ok: false, result: refuse(409, 'email_request', 'An email request - it is answered in Admin Tools.') };
  }
  const { data: events } = await db
    .from('inquiry_events').select('id, inquiry_id, type, payload, actor, occurred_at').eq('inquiry_id', inquiryId);
  return { ok: true, view: reduceInquiry(inquiryId, (events ?? []) as InquiryEvent[]), row };
}

async function append(
  db: Supa,
  inquiryId: string,
  type: InquiryEventType,
  payload: Record<string, unknown>,
  actor: string,
): Promise<InquiryResult | null> {
  const { error } = await db.from('inquiry_events').insert({
    inquiry_id: inquiryId, type, payload, actor, occurred_at: new Date().toISOString(),
  });
  if (error) {
    console.error('[inquiry-actions] event insert failed:', error);
    return refuse(500, 'event_failed');
  }
  return null;
}

function note(input: Record<string, unknown>): string | null {
  return str(input.note).slice(0, MAX_NOTE) || null;
}

type InquiryDeps = {
  whatsapp: WhatsAppAdapter;
  messages: MessageStore;
  realtorChannel: RealtorChannel;
  realtorMessages: RealtorMessageStore;
  newKey?: () => string;
};

export async function performInquiryAction(
  db: Supa,
  deps: InquiryDeps,
  actor: string,
  action: InquiryAction,
  input: Record<string, unknown>,
): Promise<InquiryResult> {
  const inquiryId = str(input.inquiryId);
  const loaded = await load(db, inquiryId);
  if (!loaded.ok) return loaded.result;
  const { view, row } = loaded;

  if (action === 'INQUIRY_REOPEN') {
    if (view.state !== 'CLOSED') return refuse(409, 'not_closed', 'The request is open.');
    return (await append(db, inquiryId, 'REOPENED', { note: note(input) }, actor)) ?? done({ recorded: 'REOPENED' });
  }

  if (view.state === 'CLOSED') return refuse(409, 'closed', 'The request is closed - reopen it first.');
  // Before the code arrives there is nobody to reply to, and asking agents on
  // behalf of a form that may never be sent is work thrown away.
  if (!row.whatsapp_confirmed_at) {
    return refuse(409, 'awaiting_code', 'The renter has not sent the WhatsApp message yet.');
  }

  if (action === 'INQUIRY_ASK_AGENT' || action === 'INQUIRY_AGENT_ANSWERED') {
    const agent = await agentFor(db, input, 'Pick an agent from the roster, or enter a new one\'s number.');
    if (typeof agent !== 'string') return agent;
    const realtorId = agent;

    if (action === 'INQUIRY_ASK_AGENT') {
      const medium = (str(input.medium) || 'ZALO').toUpperCase();
      if (!(INQUIRY_ASK_MEDIA as readonly string[]).includes(medium)) {
        return refuse(400, 'invalid_medium', 'Asked on ZALO or PHONE.');
      }
      if (medium === 'ZALO' && str(input.message)) return askOnZalo(db, deps, actor, row, realtorId, input);
      return (await append(db, inquiryId, 'AGENT_ASKED', { realtor_id: realtorId, medium, note: note(input) }, actor))
        ?? done({ recorded: 'AGENT_ASKED' });
    }

    const answer = str(input.answer).toUpperCase();
    if (!(AGENT_ANSWERS as readonly string[]).includes(answer)) {
      return refuse(400, 'invalid_answer', `The answer is one of ${AGENT_ANSWERS.join(', ')}.`);
    }
    return (await append(db, inquiryId, 'AGENT_ANSWERED', { realtor_id: realtorId, answer, note: note(input) }, actor))
      ?? done({ recorded: 'AGENT_ANSWERED' });
  }

  if (action === 'INQUIRY_CAPTURE_UNIT') return captureUnit(db, actor, row, input);
  if (action === 'INQUIRY_RECONFIRM_UNIT') return reconfirmUnit(db, row, input);
  if (action === 'INQUIRY_OFFER_UNITS') return offerUnits(db, deps, actor, row, view, input);
  if (action === 'INQUIRY_CHANGE_BRIEF') return changeBrief(db, actor, row, view, input);
  if (action === 'INQUIRY_SEND_UPDATE') return sendUpdate(db, deps, row, input);

  if (action === 'INQUIRY_CLOSE') {
    const reason = str(input.reason).toUpperCase();
    if (!(INQUIRY_CLOSE_REASONS as readonly string[]).includes(reason)) {
      return refuse(400, 'invalid_reason', `The reason is one of ${INQUIRY_CLOSE_REASONS.join(', ')}.`);
    }
    return (await append(db, inquiryId, 'CLOSED', { reason, note: note(input) }, actor)) ?? done({ recorded: 'CLOSED' });
  }

  // INQUIRY_REPLY. Checked like any operator reply to a renter: no phone
  // numbers (they reach agents through us), no booking before anything is.
  const checked = checkOperatorReply(str(input.body), 'SUBMITTED');
  if (!checked.ok) return refuse(400, 'invalid_reply', checked.error);
  const key = str(input.key) || deps.newKey?.() || crypto.randomUUID();

  let sent: { messageId: string; status: string };
  try {
    sent = await sendConciergeWhatsApp(db, deps.messages, deps.whatsapp, { inquiryId, body: checked.body, key });
  } catch (e) {
    if (e instanceof ServiceWindowClosedError) {
      return refuse(409, 'window_closed', 'Their WhatsApp window has closed. It reopens when they write to us.');
    }
    if (e instanceof ConsecutiveMessageError) {
      return refuse(409, 'too_many_consecutive', 'They have not replied to our last two messages. Wait for them.');
    }
    if (e instanceof NoWhatsAppError) return refuse(409, 'awaiting_code', (e as Error).message);
    throw e;
  }
  if (sent.status === 'FAILED') return refuse(502, 'send_failed', 'WhatsApp refused the message.');

  await recordInquiryMessage(db, {
    inquiryId, direction: 'outbound', source: 'dashboard', whatsappMessageId: sent.messageId, body: checked.body, now: new Date(),
  });
  await db.from('complex_inquiries').update({ last_message_at: new Date().toISOString() }).eq('id', inquiryId);
  return done({ recorded: 'REPLIED', messageId: sent.messageId });
}

/**
 * The renter said they would take something else - "3 bedrooms is fine too",
 * "up to 25m". Recorded against the message on the thread where they said it,
 * so a wider offer always traces back to the renter's own words, never to an
 * agent's pitch or an operator's guess.
 */
async function changeBrief(
  db: Supa,
  actor: string,
  row: InquiryRow,
  view: InquiryView,
  input: Record<string, unknown>,
): Promise<InquiryResult> {
  const messageId = str(input.messageId);
  const { data: said } = messageId
    ? await db.from('complex_inquiry_messages').select('id, inquiry_id, direction').eq('id', messageId).maybeSingle()
    : { data: null };
  if (!said || said.inquiry_id !== row.id || said.direction !== 'inbound') {
    return refuse(400, 'no_renter_message', 'Pick the message where the renter said it.');
  }
  const current = briefOf({ bedrooms: row.bedrooms_needed, budgetMaxVnd: row.budget_max_vnd }, view.brief);
  const changed = validateBriefChange(input, current);
  if (!changed.ok) return refuse(400, 'invalid_brief', changed.error);
  return (await append(db, row.id, 'BRIEF_CHANGED', {
    bedrooms: changed.value.bedrooms, budget_max_vnd: changed.value.budgetMaxVnd, message_id: messageId, note: note(input),
  }, actor)) ?? done({ recorded: 'BRIEF_CHANGED' });
}

/**
 * An availability check to one of the building's agents, with the words
 * recorded (S7.2). Through the bridge it is queued and AGENT_ASKED waits on
 * the device's ack - "asked" means the agent was sent something; by hand the
 * operator already sent it, so it is written now. Capped (outreach.ts) and
 * checked for the renter's identity like every message to an agent.
 */
async function askOnZalo(
  db: Supa,
  deps: InquiryDeps,
  actor: string,
  row: InquiryRow,
  realtorId: string,
  input: Record<string, unknown>,
): Promise<InquiryResult> {
  const now = new Date();
  const facts = await loadOutreach(db, realtorId, now);
  const why = outreachRefusal({ ...facts, inquiryId: row.id, now });
  if (why) return refuse(429, 'outreach_capped', why);

  // The renter, read for one purpose: making sure the message does not carry
  // them. The form's name and the number the code came from, and the name on
  // their renter row if it differs.
  const { data: who } = await db.from('complex_inquiries').select('phone, full_name').eq('id', row.id).maybeSingle();
  const { data: renter } = row.renter_id
    ? await db.from('renters').select('phone_e164, display_name').eq('id', row.renter_id).maybeSingle()
    : { data: null };

  let sent;
  try {
    // The renter-row name, if it differs from the form's; sendToRealtor checks
    // the form's name and the number itself.
    if (renter?.display_name && renter.display_name !== who?.full_name) {
      assertNoRenterIdentity(str(input.message), { display_name: renter.display_name });
    }
    sent = await sendToRealtor(deps.realtorMessages, deps.realtorChannel, {
      inquiryId: row.id, realtorId, medium: 'ZALO', purpose: 'AVAILABILITY_CHECK',
      body: str(input.message), actor, idempotencyKey: `${row.id}:${realtorId}:AVAILABILITY_CHECK`,
      renter: { phone_e164: who?.phone ?? renter?.phone_e164 ?? null, display_name: who?.full_name ?? null },
    });
  } catch (e) {
    if (e instanceof RenterIdentityError) return refuse(400, 'renter_identity', e.message);
    return refuse(400, 'invalid_message', (e as Error).message);
  }
  if (sent.message.status === 'FAILED') return refuse(502, 'send_failed', 'The message could not be queued.');

  const event = {
    inquiry_id: row.id, type: 'AGENT_ASKED', actor,
    payload: { realtor_id: realtorId, medium: 'ZALO', message_id: sent.message.id, note: note(input) },
  };
  if (sent.message.status === 'QUEUED') {
    // Written by zalo-bridge when the device says it went (bridgeAck).
    const { error } = await db.from('realtor_messages').update({ on_sent_event: event }).eq('id', sent.message.id);
    if (error) return refuse(500, 'event_failed');
    return done({ recorded: 'AGENT_ASKED', queued: true, messageId: sent.message.id });
  }
  return (await append(db, row.id, 'AGENT_ASKED', event.payload, actor))
    ?? done({ recorded: 'AGENT_ASKED', queued: false, messageId: sent.message.id });
}

/**
 * The agent a step is about, as a realtor id: one on file (`realtorId`), or
 * one met in a Facebook or Zalo group while searching - by their number
 * (`agentPhone`, and `agentName` if known), added to `realtors` so the ask,
 * the unit and the bridge all key on them. A search's agents are mostly not on
 * file: no building roster lists them, and they have never listed with us.
 */
async function agentFor(db: Supa, input: Record<string, unknown>, pick: string): Promise<string | InquiryResult> {
  const realtorId = str(input.realtorId);
  if (realtorId) {
    const { data: realtor } = await db.from('realtors').select('id').eq('id', realtorId).maybeSingle();
    return realtor ? realtorId : refuse(400, 'invalid_realtor', pick);
  }
  if (!str(input.agentPhone)) return refuse(400, 'invalid_realtor', pick);
  // Agents are +84 only (toE164); a renter may be on any number, an agent not.
  const phone = toE164(str(input.agentPhone));
  if (!phone) return refuse(400, 'invalid_phone', `Not a Vietnamese mobile number: ${str(input.agentPhone)}`);
  const realtor = await upsertRealtor(db, phone, str(input.agentName).slice(0, MAX_AGENT_NAME) || null);
  return realtor ? realtor.id : refuse(500, 'realtor_failed');
}

// ── Units (S7.1b) ───────────────────────────────────────────────────────────

const LISTING_COLUMNS =
  'id, is_active, price_vnd, price_confidence, bedrooms, area_sqm, district_code, realtor_id, title, source, external_id, last_verified_at';

type UnitListing = ShortlistCandidate & { source: string; external_id: string; last_verified_at: string | null };

/** Is this listing one of this request's captured units? */
const capturedFor = (listing: { source?: unknown; external_id?: unknown }, inquiryId: string) =>
  listing.source === CONCIERGE_SOURCE && String(listing.external_id ?? '').startsWith(`concierge:${inquiryId}:`);

/**
 * An agent's offered unit, entered as a listing. Written raw and parsed by the
 * canonical trigger like any crawled row, then held to the same gate intake
 * uses - a unit Request viewing would refuse is not worth offering, so it is
 * removed and the reason returned.
 */
async function captureUnit(db: Supa, actor: string, row: InquiryRow, input: Record<string, unknown>): Promise<InquiryResult> {
  const agent = await agentFor(db, input, 'Pick the agent who offered it, or enter their number.');
  if (typeof agent !== 'string') return agent;
  const v = validateUnit({ ...input, realtorId: agent }, unitPhotoPath(row.id));
  if (!v.ok) return refuse(400, 'invalid_unit', v.error);

  const place = await placeOf(db, row);
  if (!place) return refuse(404, 'invalid_complex');
  // An area's unit says where it is - one of the area's districts - so the
  // canonical trigger can place it; a building's unit is at the building.
  let complex: { name: string; district: string | null; city: string };
  if (place.kind === 'AREA') {
    const code = v.value.districtCode;
    if (!code || !place.districtCodes.includes(code)) {
      return refuse(400, 'invalid_district', `Pick which of ${place.name} it is in.`);
    }
    complex = { name: v.value.building || districtLabel(code), district: districtLabel(code), city: place.city };
  } else {
    complex = { name: place.name, district: place.district, city: place.city };
  }
  // The viewing flow is Ho Chi Minh City only; a unit elsewhere could never be requested.
  if (complex.city !== 'ho_chi_minh') return refuse(409, 'outside_hcmc', 'Viewings are arranged in Ho Chi Minh City only.');

  const id = crypto.randomUUID();
  const { error } = await db.from('external_properties')
    .insert(unitRow({ id, inquiryId: row.id, complex, unit: v.value, now: new Date() }));
  if (error) {
    console.error('[inquiry-actions] unit insert failed:', error);
    return refuse(500, 'unit_failed');
  }

  const { data: saved } = await db.from('external_properties').select(LISTING_COLUMNS).eq('id', id).maybeSingle();
  const { eligible, rejected } = screenCandidates([id], saved ? [saved as ShortlistCandidate] : []);
  if (eligible.length === 0) {
    await db.from('external_properties').delete().eq('id', id);
    return refuse(422, 'not_requestable', rejected[0]?.reason ?? 'That unit could not be requested.');
  }
  // The trigger places a unit by its location, so a building named after
  // another district ("Thu Duc House" in District 2) would land there - and an
  // area's offer, its watch and the itinerary's district checks would all
  // believe it.
  if (place.kind === 'AREA' && saved?.district_code !== v.value.districtCode) {
    await db.from('external_properties').delete().eq('id', id);
    return refuse(422, 'wrong_district',
      `"${complex.name}" reads as ${districtLabel(String(saved?.district_code))}, not ${complex.district}. ` +
      `Leave the district out of the building's name.`);
  }

  const failed = await append(db, row.id, 'UNIT_CAPTURED', { listing_id: id, realtor_id: v.value.realtorId, note: v.value.note }, actor);
  return failed ?? done({ recorded: 'UNIT_CAPTURED', listingId: id });
}

/**
 * The agent says it is still free: good for another UNIT_FRESH_DAYS. A fact
 * about the listing, not a step of the request, so no event.
 */
async function reconfirmUnit(db: Supa, row: InquiryRow, input: Record<string, unknown>): Promise<InquiryResult> {
  const listingId = str(input.listingId);
  const { data: listing } = listingId
    ? await db.from('external_properties').select('id, source, external_id').eq('id', listingId).maybeSingle()
    : { data: null };
  if (!listing || !capturedFor(listing, row.id)) return refuse(404, 'not_captured', "Not one of this request's units.");
  const now = new Date().toISOString();
  await db.from('external_properties').update({
    is_active: true, deactivated_at: null, last_verified_at: now,
    last_verification_status: 'alive', last_verification_reason: 'agent_confirmed',
  }).eq('id', listingId);
  return done({ recorded: 'UNIT_RECONFIRMED' });
}

/** Has the renter written on this request's thread since `since`? */
async function renterWroteSince(db: Supa, inquiryId: string, since: string): Promise<boolean> {
  const { data } = await db
    .from('complex_inquiry_messages').select('id, created_at')
    .eq('inquiry_id', inquiryId).eq('direction', 'inbound').gte('created_at', since);
  return ((data ?? []) as { created_at: string }[]).some(m => Date.parse(m.created_at) > Date.parse(since));
}

/**
 * The one message with the units in it - for this request, and optionally the
 * same renter's other open requests (`alsoFor`), so a renter asking about two
 * buildings gets one message rather than a second offer stuck behind the
 * two-in-a-row limit.
 *
 * Every unit must be requestable now, belong to its request (captured for it,
 * or advertised at its building - an area takes captured units only), fit
 * what the renter asked for there - or
 * what they have since said they would take - and, if captured, have been
 * confirmed by its agent within UNIT_FRESH_DAYS. After a request's first offer,
 * another for it waits for the renter to answer. Sent once, then recorded on
 * each request three ways: on its thread, as UNITS_OFFERED, and in alert_items
 * so the weekly alert does not offer the same places again.
 */
async function offerUnits(
  db: Supa,
  deps: { whatsapp: WhatsAppAdapter; messages: MessageStore; newKey?: () => string },
  actor: string,
  row: InquiryRow,
  view: InquiryView,
  input: Record<string, unknown>,
): Promise<InquiryResult> {
  const idsOf = (v: unknown): string[] =>
    Array.isArray(v) ? [...new Set((v as unknown[]).map(x => str(x)).filter(Boolean))] : [];

  const parts: { row: InquiryRow; view: InquiryView; ids: string[] }[] = [{ row, view, ids: idsOf(input.listingIds) }];
  for (const extra of Array.isArray(input.alsoFor) ? input.alsoFor as Record<string, unknown>[] : []) {
    const otherId = str(extra?.inquiryId);
    if (parts.some(p => p.row.id === otherId)) return refuse(400, 'invalid_units', 'Each request once.');
    const other = await load(db, otherId);
    // Only the same renter's own requests: one message to one person.
    if (!other.ok || !row.renter_id || other.row.renter_id !== row.renter_id) {
      return refuse(400, 'not_same_renter', 'Only this renter\'s other requests can go in the same message.');
    }
    if (other.view.state === 'CLOSED' || !other.row.whatsapp_confirmed_at) {
      return refuse(409, 'closed', 'That other request is closed or not confirmed.');
    }
    parts.push({ row: other.row, view: other.view, ids: idsOf(extra?.listingIds) });
  }
  const total = parts.reduce((n, p) => n + p.ids.length, 0);
  if (parts.some(p => p.ids.length === 0 || p.ids.length > MAX_OFFER_UNITS) || total > MAX_COMBINED_UNITS) {
    return refuse(400, 'invalid_units',
      `Pick 1 to ${MAX_OFFER_UNITS} units per building, ${MAX_COMBINED_UNITS} in all.`);
  }

  let message: string | null = null;
  if (str(input.message)) {
    const checked = checkOperatorReply(str(input.message), 'SUBMITTED');
    if (!checked.ok) return refuse(400, 'invalid_reply', checked.error);
    message = checked.body;
  }

  const now = new Date();
  const sections: OfferSection[] = [];
  for (const p of parts) {
    const checked = await offerableUnits(db, p.row, p.view, p.ids, now);
    if ('status' in checked) return checked;
    sections.push(checked);
  }

  const body = renderOfferSections({
    firstName: (row.full_name ?? '').trim().split(/\s+/)[0] || null,
    message,
    now,
    sections,
    // Said as it is for them: covered by the Pass, or their free viewing.
    hasPass: await hasPassCover(db, row.user_id ?? null),
  });

  let sent: { messageId: string; status: string };
  try {
    sent = await sendConciergeWhatsApp(db, deps.messages, deps.whatsapp, {
      inquiryId: row.id, body, key: str(input.key) || deps.newKey?.() || crypto.randomUUID(),
    });
  } catch (e) {
    if (e instanceof ServiceWindowClosedError) {
      return refuse(409, 'window_closed', 'Their WhatsApp window has closed. It reopens when they write to us.');
    }
    if (e instanceof ConsecutiveMessageError) {
      return refuse(409, 'too_many_consecutive', 'They have not replied to our last two messages. Wait for them.');
    }
    if (e instanceof NoWhatsAppError) return refuse(409, 'awaiting_code', (e as Error).message);
    throw e;
  }
  if (sent.status === 'FAILED') return refuse(502, 'send_failed', 'WhatsApp refused the message.');

  // The same message on each request's thread, so a reply to it is filed on
  // each (concierge.ts), and each request's log says what it was offered.
  let failed: InquiryResult | null = null;
  for (const p of parts) {
    await recordInquiryMessage(db, {
      inquiryId: p.row.id, direction: 'outbound', source: 'dashboard', whatsappMessageId: sent.messageId, body, now,
    });
    await db.from('complex_inquiries').update({ last_message_at: now.toISOString() }).eq('id', p.row.id);
    if (p.row.renter_id) {
      // Already news to them, so the alert sweep must not send these again.
      const { error } = await db.from('alert_items').insert(p.ids.map(listingId => ({
        renter_id: p.row.renter_id, listing_id: listingId, watch_id: p.row.watch_id, source: 'WATCH',
        message_id: sent.messageId, detail_sent_at: now.toISOString(),
      })));
      if (error && error.code !== '23505') console.error('[inquiry-actions] alert_items insert failed:', error.message ?? error);
    }
    failed = (await append(db, p.row.id, 'UNITS_OFFERED', { listing_ids: p.ids, message_id: sent.messageId }, actor)) ?? failed;
  }
  return failed ?? done({ recorded: 'UNITS_OFFERED', messageId: sent.messageId, requests: parts.length });
}

/**
 * One request's units, checked for the offer, or the refusal. The rules of
 * `offerUnits`, for a single building.
 */
async function offerableUnits(
  db: Supa,
  row: InquiryRow,
  view: InquiryView,
  ids: string[],
  now: Date,
): Promise<OfferSection | InquiryResult> {
  const place = await placeOf(db, row);
  const where = place?.name ?? 'the building';
  // One offer, then their answer. A second list they did not ask for is the
  // agents' stock arriving in instalments, however good each unit is.
  if (view.offeredAt && !(await renterWroteSince(db, row.id, view.offeredAt))) {
    return refuse(409, 'awaiting_renter',
      `They have not answered the last offer for ${where} yet. Send more once they reply.`);
  }

  const { data: found } = await db.from('external_properties').select(LISTING_COLUMNS).in('id', ids);
  const listings = (found ?? []) as UnitListing[];
  const { eligible, rejected } = screenCandidates(ids, listings);
  if (rejected.length > 0) {
    return refuse(422, 'not_requestable', `${rejected.length} of those cannot be requested: ${rejected[0].reason}`);
  }

  // Priority search promises every place is confirmed with its agent: an ad is
  // not availability. So an area's offer carries only its captured units - an
  // advertised listing in its districts is a lead, asked about and then added.
  if (place?.kind === 'AREA') {
    const ad = listings.find(l => !capturedFor(l, row.id));
    if (ad) {
      return refuse(422, 'not_confirmed',
        `"${ad.title}" is advertised, not confirmed. Ask its agent, then add it as a unit.`);
    }
  }

  // On file: advertised at the building.
  const { data: atBuilding } = row.complex_id
    ? await db.rpc('complex_listing_ids', { _complex_id: row.complex_id, _since: '-infinity' })
    : { data: [] };
  const onFile = new Set(((atBuilding ?? []) as unknown[])
    .map(x => (typeof x === 'string' ? x : String((x as Record<string, unknown>).complex_listing_ids))));
  const brief = briefOf({ bedrooms: row.bedrooms_needed, budgetMaxVnd: row.budget_max_vnd }, view.brief);
  for (const l of listings) {
    const captured = capturedFor(l, row.id);
    if (!captured && !onFile.has(l.id)) {
      return refuse(422, 'not_this_building', `"${l.title}" is not ${place?.kind === 'AREA' ? 'in' : 'at'} ${where}.`);
    }
    const off = misfit({ bedrooms: Number(l.bedrooms), priceVnd: Number(l.price_vnd) }, brief);
    if (off) {
      return refuse(422, 'outside_brief',
        `"${l.title}" is ${off}. Offer it only if they say they would take it - record that as a change to what they want.`);
    }
    if (captured && unitStale(l.last_verified_at, now)) {
      return refuse(409, 'stale_unit',
        `"${l.title}" was last confirmed over ${UNIT_FRESH_DAYS} days ago - reconfirm it with the agent first.`);
    }
  }

  const byId = new Map(listings.map(l => [l.id, l]));
  return {
    complexName: where,
    inquiryId: row.id,
    kind: place?.kind ?? 'BUILDING',
    units: eligible.map(c => {
      const l = byId.get(c.id)!;
      return {
        id: l.id, title: l.title ?? 'A place', priceVnd: Number(l.price_vnd), bedrooms: Number(l.bedrooms),
        areaSqm: l.area_sqm ?? null, confirmedAt: capturedFor(l, row.id) ? l.last_verified_at : null,
      };
    }),
  };
}

// ── After the window (S7.1c) ────────────────────────────────────────────────

/** The `request_update` template's body, as Meta will render it - for the thread. */
export function renderRequestUpdate(firstName: string | null, complexName: string): string {
  return `Hi ${firstName?.trim() || 'there'}, we have an update on your request for ${complexName}. Reply here to see it.`;
}

/**
 * The window shut before the news was ready: send `request_update`, which
 * carries no news, so their reply reopens the window for the offer. Only
 * when the window is shut - inside it a normal reply costs nothing extra -
 * and refused as not-yet-approved until Meta approves the template.
 */
async function sendUpdate(
  db: Supa,
  deps: { whatsapp: WhatsAppAdapter; messages: MessageStore; newKey?: () => string },
  row: InquiryRow,
  input: Record<string, unknown>,
): Promise<InquiryResult> {
  if (!row.renter_id) return refuse(409, 'awaiting_code', 'The renter has not sent the WhatsApp message yet.');
  const renter = await deps.messages.getRenter(row.renter_id);
  if (renter && isWindowOpen(renter, new Date())) {
    return refuse(409, 'window_open', 'Their window is open - send a normal reply instead.');
  }

  const place = await placeOf(db, row);
  const firstName = (row.full_name ?? '').trim().split(/\s+/)[0] || null;
  const complexName = place?.name ?? 'the building';

  let sent: { message: { id: string; status: string } };
  try {
    sent = await sendTemplate(deps.messages, deps.whatsapp, {
      renterId: row.renter_id,
      purpose: `REQUEST_UPDATE:${row.id}:${str(input.key) || deps.newKey?.() || crypto.randomUUID()}`,
      templateName: TEMPLATES.REQUEST_UPDATE.name,
      params: [firstName || 'there', complexName],
    });
  } catch (e) {
    if (e instanceof UnapprovedTemplateError) {
      return refuse(409, 'template_not_approved',
        'The request_update template is not approved by Meta yet - see docs/whatsapp-go-live.md.');
    }
    if (e instanceof ConsecutiveMessageError) {
      return refuse(409, 'too_many_consecutive', 'They have not replied to our last two messages. Wait for them.');
    }
    throw e;
  }
  if (sent.message.status === 'FAILED') return refuse(502, 'send_failed', 'WhatsApp refused the message.');

  const now = new Date();
  // On the thread, so their reply to it routes back to this request.
  await recordInquiryMessage(db, {
    inquiryId: row.id, direction: 'outbound', source: 'dashboard', whatsappMessageId: sent.message.id,
    body: renderRequestUpdate(firstName, complexName), now,
  });
  await db.from('complex_inquiries').update({ last_message_at: now.toISOString() }).eq('id', row.id);
  return done({ recorded: 'UPDATE_SENT', messageId: sent.message.id });
}
