// What changed on the requests since operators last heard, as one email
// (2026-10-08, the admin revamp).
//
// Three kinds of request reach an operator: viewing requests, availability
// requests for a building, and priority searches (an area).
// Before this, a new viewing request was emailed and so were an agent's
// replies about a building - but a renter answering on WhatsApp, a plan going
// out or lapsing, a lock-in, or the AI operator handing something to a person
// reached nobody until they opened the console.
//
// One email per pass of the drain (every 15 minutes), only when something
// happened, with what needs a person first. Not one per event: at ~25
// requests a day and the AI operator acting alone, that would be dozens of
// emails a day, and the one that matters would be lost among them. What the
// renter or agent said is never quoted - the console is where it is read -
// and nothing names the renter (ops-alert.ts).
//
// Pure: the drain reads the rows, this decides what they say.

import type { DomainEvent, InquiryEvent } from '../viewing-domain.ts';
import { CONSOLE_URL, type IntakeAlert } from './ops-alert.ts';
import { hcmcLong } from './format.ts';
import { consoleLink } from './inbox.ts';
import { REPLY_WITHIN_HOURS, replyWithinText } from './place.ts';

export const OPS_DIGEST_JOB = 'OPS_DIGEST';

/** Nothing more often than this unless something needs a person. */
export const DIGEST_MIN_GAP_MS = 30 * 60 * 1000;

export type RequestKind = 'VIEWING' | 'BUILDING' | 'SEARCH';

export interface Update {
  kind: RequestKind;
  /** HV-4KX2, or the building or area. */
  name: string;
  what: string;
  needsYou: boolean;
  at: string;
  /** The console, opened on this request - given for what needs a person. */
  link?: string;
}

const OUTCOME_WORDS: Record<string, string> = {
  CONFIRMED: 'an agent confirmed a time',
  ALTERNATIVE_OFFERED: 'an agent offered other times',
  UNAVAILABLE_DATE: 'an agent is not free at those times',
  ALREADY_RENTED: 'a place is already rented',
  PRICE_CHANGED: 'an agent quoted a new price',
  NO_RESPONSE: 'an agent never answered - closed as no response',
  UNREACHABLE: 'an agent\'s number does not work',
};

const CANCEL_WORDS: Record<string, string> = {
  RENTER_DECLINED: 'the renter declined',
  RENTER_FOUND_PLACE: 'the renter found a place',
  RENTER_UNRESPONSIVE: 'the renter went quiet',
  DUPLICATE: 'a duplicate',
  NOT_LOCKED_IN: 'not locked in by the deadline - agents are owed a release',
  OTHER: 'other',
};

/** Replies the system does not act on alone (intent.ts). */
const NEEDS_A_PERSON = new Set(['QUESTION', 'RESCHEDULE', 'DECLINE', 'UNKNOWN']);

/** A viewing request's events, in operator words. */
export function viewingUpdates(ref: string, events: DomainEvent[], requestId?: string): Update[] {
  const out: Update[] = [];
  const link = requestId ? consoleLink('VIEWING', requestId) : undefined;
  const add = (e: DomainEvent, what: string, needsYou = false) =>
    out.push({ kind: 'VIEWING', name: ref, what, needsYou, at: e.occurred_at, ...(link ? { link } : {}) });
  for (const e of events) {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    switch (e.type) {
      case 'RENTER_REPLIED': {
        if (p.handshake === true) break;
        const intent = String(p.intent ?? 'UNKNOWN');
        if (intent === 'CONFIRM') add(e, 'the renter said yes on WhatsApp');
        else if (intent === 'OPT_OUT') add(e, 'the renter opted out of WhatsApp messages', true);
        else if (NEEDS_A_PERSON.has(intent)) add(e, `the renter wrote on WhatsApp (${intent.toLowerCase()}) - it needs an answer`, true);
        break;
      }
      case 'OUTCOME_RECORDED': {
        const words = OUTCOME_WORDS[String(p.outcome)];
        if (words) add(e, words);
        break;
      }
      case 'ITINERARY_DELIVERED': add(e, 'the plan went to the renter'); break;
      case 'ITINERARY_HELD': add(e, 'the plan is ready, waiting for the renter to reply'); break;
      case 'REQUEST_CONFIRMED':
        add(e, `the renter locked the plan in${p.cover === 'PASS' ? ' with the Pass' : p.cover === 'FREE_VIEWING' ? ' with their free viewing' : ''}`);
        break;
      case 'REQUEST_FAILED': add(e, 'nothing could be confirmed'); break;
      case 'REQUEST_CANCELLED':
        // A renter's own cancellation on the web is emailed as it happens
        // (renter-edits.ts); this is the rest.
        if (e.actor === 'RENTER') break;
        add(e, `cancelled - ${CANCEL_WORDS[String(p.reason)] ?? String(p.reason ?? 'no reason')}`);
        break;
    }
  }
  return out;
}

/** An Extensive search's events - a building's, or an area's. */
export function inquiryUpdates(kind: 'BUILDING' | 'SEARCH', name: string, events: InquiryEvent[], inquiryId?: string): Update[] {
  const out: Update[] = [];
  const link = inquiryId ? consoleLink(kind, inquiryId) : undefined;
  const label = kind === 'SEARCH' ? 'area search' : 'availability request';
  for (const e of events) {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const add = (what: string, needsYou = false) =>
      out.push({ kind, name, what, needsYou, at: e.occurred_at, ...(link ? { link } : {}) });
    switch (e.type) {
      case 'CONFIRMED':
        add(`new ${label} - the renter is waiting, reply due within ${replyWithinText(REPLY_WITHIN_HOURS[kind === 'SEARCH' ? 'AREA' : 'BUILDING'])}`, true);
        break;
      case 'BRIEF_CHANGED': add('the renter changed what they would take', true); break;
      case 'UNITS_OFFERED': add('units went to the renter'); break;
      case 'CLOSED': add(`closed (${String(p.reason ?? 'OTHER').toLowerCase().replace(/_/g, ' ')})`); break;
      case 'REOPENED': add('reopened', true); break;
    }
  }
  return out;
}

/** A renter's message on an availability thread. */
export function inquiryMessageUpdate(kind: 'BUILDING' | 'SEARCH', name: string, at: string, inquiryId?: string): Update {
  return {
    kind, name, what: 'the renter wrote on WhatsApp - it needs an answer', needsYou: true, at,
    ...(inquiryId ? { link: consoleLink(kind, inquiryId) } : {}),
  };
}

/** The AI operator handing something to a person. */
export function escalationUpdate(ref: string, rationale: string, at: string, requestId?: string): Update {
  const why = rationale.length > 200 ? `${rationale.slice(0, 200)}...` : rationale;
  return {
    kind: 'VIEWING', name: ref, what: `the AI operator needs a person: ${why}`, needsYou: true, at,
    ...(requestId ? { link: consoleLink('VIEWING', requestId) } : {}),
  };
}

const KIND_LABEL: Record<RequestKind, string> = {
  VIEWING: 'Viewing requests',
  BUILDING: 'Building availability',
  SEARCH: 'Area searches',
};

/**
 * Should a digest go now? Anything needing a person goes on the next pass;
 * news alone waits until the last digest is DIGEST_MIN_GAP_MS old.
 */
export function digestDue(updates: Update[], lastSentAt: number | null, now: number): boolean {
  if (updates.length === 0) return false;
  if (updates.some(u => u.needsYou)) return true;
  return lastSentAt == null || now - lastSentAt >= DIGEST_MIN_GAP_MS;
}

export function renderDigest(updates: Update[]): IntakeAlert | null {
  if (updates.length === 0) return null;
  const sorted = [...updates].sort((a, b) => a.at.localeCompare(b.at));
  const needs = sorted.filter(u => u.needsYou);
  const news = sorted.filter(u => !u.needsYou);
  const line = (u: Update) => `- ${u.name}: ${u.what} (${hcmcLong(u.at)})`;

  const sections: string[] = [];
  // Each with its link: what needs a person should be one click from the inbox.
  if (needs.length) sections.push('NEEDS YOU', ...needs.map(u => (u.link ? `${line(u)}
  ${u.link}` : line(u))), '');
  if (news.length) {
    for (const kind of ['VIEWING', 'BUILDING', 'SEARCH'] as RequestKind[]) {
      const of = news.filter(u => u.kind === kind);
      if (of.length) sections.push(KIND_LABEL[kind].toUpperCase(), ...of.map(line), '');
    }
  }
  const subject = needs.length
    ? `Hausto ops - ${needs.length} need${needs.length === 1 ? 's' : ''} you${news.length ? `, ${news.length} update${news.length === 1 ? '' : 's'}` : ''}`
    : `Hausto ops - ${news.length} update${news.length === 1 ? '' : 's'}`;
  return {
    subject,
    text: [...sections, `Work them in the console: ${CONSOLE_URL}`, 'Times are Ho Chi Minh City.'].join('\n'),
  };
}
