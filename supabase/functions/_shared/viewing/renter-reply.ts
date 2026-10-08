// A drafted answer to a renter's question, for an operator to approve.
//
// Stage 1 escalated every renter reply that was not a yes or a stop. Most of
// them are one of three things: a question the listing already answers ("is
// it furnished?"), a new time ("can we do Saturday instead?"), or something
// that needs checking with the agent. A person still decides every one - this
// only means they start from a draft instead of a blank box.
//
// What the model is given is the privacy rule written as a data structure:
// listing facts, what each agent said as typed outcomes, and the renter's own
// messages with any phone number masked. No agent contact, no renter contact,
// because a model cannot repeat what it was never shown (invariant 4).
//
// Every draft then passes `checkOperatorReply` - the same server check an
// operator's own reply passes - so a draft that says "booked" before the
// renter has confirmed, or carries a number, never becomes a proposal.

import { checkOperatorReply } from './thread.ts';
import { formatVnd, hcmcLong } from './format.ts';
import type { RequestState } from '../viewing-domain.ts';
import { districtLabel } from './place.ts';

export const REPLY_MODEL = 'gpt-4o-mini';

/** One WhatsApp message, and a short one: every message in the window is billed. */
export const MAX_DRAFT_CHARS = 600;

export interface ListingFacts {
  itemId: string;
  title: string;
  districtCode: string | null;
  location: string | null;
  priceVnd: number;
  bedrooms: number | null;
  areaSqm: number | null;
  amenities: string[];
  description: string | null;
  /** Where this unit stands, in words: "confirmed for Tue 29 Sep, 09:00", "already rented". */
  status: string;
}

export interface ThreadLine {
  direction: 'IN' | 'OUT';
  body: string;
  at: string;
}

export interface DraftContext {
  ref: string;
  state: RequestState;
  listings: ListingFacts[];
  /** Oldest first. The newest renter messages are the ones being answered. */
  thread: ThreadLine[];
  now: Date;
}

export type DraftResult =
  | { kind: 'DRAFT'; message: string; confidence: 'HIGH' | 'LOW'; needsAgent: boolean; note: string }
  | { kind: 'ESCALATE'; reason: string };

/** Same pattern as ops_request_thread() and privacy.ts: any number a person could dial. */
const PHONE = /(?<!\d)(?:\+?84|0)[\s.-]?[35789](?:[\s.-]?\d){8}(?!\d)/g;

export function maskPhones(text: string): string {
  return text.replace(PHONE, '[number hidden]');
}

export const REPLY_PROMPT = `You draft one WhatsApp reply for Hausto, a service in Ho Chi Minh City that arranges rental viewings.
The renter never talks to agents; we do. A human operator reads your draft, may edit it, and sends it.

Return JSON only:
{
  "reply": "the message to send",
  "needs_agent": true | false,
  "confident": true | false,
  "note": "one line for the operator: what you answered, and what they must still do"
}

Write the reply:
- In English, plain and friendly, at most 4 short sentences. One message only.
- Answer only from the facts given. If the answer is not in the facts, say we will check with the agent and come back, and set needs_agent true.
- If they ask to move a viewing or suggest new times, acknowledge the times they gave, say we will ask the agents, and set needs_agent true. Never say a new time is agreed.
- Never promise a unit, a price or a time that the facts do not show as confirmed.
- Do not explain why a place fell through unless the renter asks about it.
- Never say "booked" or "booking" unless the request state is CONFIRMED.
- Never give any phone number, name, or contact for an agent or landlord. If asked, say we arrange everything for them.
- Refer to places by their titles. End with the request ref in the form "Ref HV-XXXX".
- Use "-" not an em dash.

Set confident false when the message is unclear, angry, about money owed, a complaint, or anything a person should read first.`;

/** The user turn: facts, then the conversation. */
export function buildDraftInput(ctx: DraftContext): string {
  const listings = ctx.listings.map((l, i) => [
    `${i + 1}. ${l.title}`,
    `   Status: ${l.status}`,
    `   Price: ${formatVnd(l.priceVnd)}/month`,
    `   ${[
      l.bedrooms != null ? `${l.bedrooms === 0 ? 'Studio' : `${l.bedrooms} bedroom${l.bedrooms === 1 ? '' : 's'}`}` : '',
      l.areaSqm != null ? `${l.areaSqm} m2` : '',
      // In words, so the draft says "Binh Thanh" rather than echoing `BINH_THANH`.
      l.districtCode ? districtLabel(l.districtCode) : '',
      l.location ?? '',
    ].filter(Boolean).join(', ')}`,
    l.amenities.length ? `   Amenities: ${l.amenities.slice(0, 20).join(', ')}` : '',
    l.description ? `   Description: ${maskPhones(l.description).replace(/\s+/g, ' ').slice(0, 600)}` : '',
  ].filter(Boolean).join('\n'));

  const thread = ctx.thread.slice(-12).map(t =>
    `${t.direction === 'IN' ? 'Renter' : 'Hausto'} (${hcmcLong(t.at)}): ${maskPhones(t.body).slice(0, 800)}`);

  return [
    `Request ${ctx.ref}, state ${ctx.state}. Now: ${hcmcLong(ctx.now.toISOString())} (Asia/Ho_Chi_Minh).`,
    '',
    'Places in this request:',
    ...listings,
    '',
    'Conversation, oldest first:',
    ...thread,
    '',
    'Draft the reply to the renter\'s latest message(s).',
  ].join('\n');
}

/** What the model returned, checked against our rules - or an escalation saying why not. */
export function interpretDraft(raw: unknown, ctx: DraftContext): DraftResult {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const text = typeof r.reply === 'string' ? r.reply.trim() : '';
  if (!text) return { kind: 'ESCALATE', reason: 'No draft came back.' };
  if (text.length > MAX_DRAFT_CHARS) return { kind: 'ESCALATE', reason: `The draft ran to ${text.length} characters - too long for one message.` };

  // The same check an operator's own reply passes on the server.
  const check = checkOperatorReply(text, ctx.state);
  if (!check.ok) return { kind: 'ESCALATE', reason: `The draft broke a rule: ${check.error}` };

  const body = check.body.includes(ctx.ref) ? check.body : `${check.body}\nRef ${ctx.ref}`;
  const needsAgent = r.needs_agent === true;
  return {
    kind: 'DRAFT',
    message: body,
    needsAgent,
    confidence: r.confident === true && !needsAgent ? 'HIGH' : 'LOW',
    note: typeof r.note === 'string' ? r.note.trim().slice(0, 300) : '',
  };
}

/** A unit's standing in words, for the model and nothing else. */
export function describeStatus(state: string, slots: unknown[], actualPriceVnd?: number): string {
  const times = (slots as { starts_at?: string }[]).map(s => s?.starts_at).filter((t): t is string => !!t);
  switch (state) {
    case 'CONFIRMED': return `confirmed for ${times.map(hcmcLong).join(', ') || 'a time still to be set'}`;
    case 'ALTERNATIVE_OFFERED': return `the agent cannot do the renter's times but offered ${times.map(hcmcLong).join(' or ')}`;
    case 'UNAVAILABLE': return 'the agent cannot do the renter\'s times and offered no others';
    case 'ALREADY_RENTED': return 'already rented - no longer available';
    case 'PRICE_CHANGED': return `still available, but the agent now asks ${actualPriceVnd ? formatVnd(actualPriceVnd) : 'a different price'} a month`;
    case 'NO_RESPONSE': return 'the agent never answered';
    case 'UNREACHABLE': return 'we could not reach the agent';
    case 'CONTACTED': return 'we have asked the agent and are waiting for an answer';
    case 'WITHDRAWN': return 'the renter took this place out of the request';
    default: return 'we have not reached the agent yet';
  }
}
