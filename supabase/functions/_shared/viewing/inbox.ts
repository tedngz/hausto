// Every request a person may need to act on, of all three kinds, in one
// ranking (2026-10-08, the admin revamp).
//
// A viewing request, an availability request for a building and a priority
// search (an area) are worked in different screens of the
// console, but an operator starting their day needs one list: what is late,
// what is waiting on us, and what can wait. The console's Inbox, the admin
// page's overview and the digest's links all read it from here, so the three
// cannot disagree about what is urgent.
//
// Pure: the callers read the rows. Viewing requests rank by `triage` (the
// console's own queue order); availability requests by the reply promised
// from the renter's WhatsApp code (24 hours for a building, 48 for an area).

import {
  inquiryDeadline, reduceInquiry, reduceRequest,
  type DomainEvent, type InquiryEvent, type InquiryView,
} from '../viewing-domain.ts';
import { triage, type Urgency } from './triage.ts';
import { waitingReplies } from './thread.ts';
import { CONSOLE_URL } from './ops-alert.ts';

export type InboxKind = 'VIEWING' | 'BUILDING' | 'SEARCH';

export interface InboxRow {
  kind: InboxKind;
  id: string;
  /** HV-4KX2, or the building or area. */
  name: string;
  /** The derived state, as the console shows it. */
  state: string;
  waitingOn: string;
  urgency: Urgency;
  /** Lower sorts first, across kinds. */
  rank: number;
  actionable: boolean;
  createdAt: string;
  /** When the renter was promised an answer by, where there is a promise. */
  dueAt: string | null;
  /** AI operator proposals waiting for a person (viewing requests only). */
  proposals: number;
}

export const KIND_LABEL: Record<InboxKind, string> = {
  VIEWING: 'Viewing',
  BUILDING: 'Building',
  SEARCH: 'Area search',
};

/** The console, opened on this request. */
export function consoleLink(kind: InboxKind, id: string): string {
  return `${CONSOLE_URL}/#/${kind === 'VIEWING' ? 'request' : 'inquiry'}/${id}`;
}

const URGENCY_RANK: Record<Urgency, number> = { LATE: 0, WARN: 10, OK: 20 };

export function viewingInboxRow(opts: {
  id: string;
  ref: string;
  createdAt: string;
  events: DomainEvent[];
  proposals?: number;
  now: number;
}): InboxRow {
  const view = reduceRequest(opts.id, opts.events);
  // The last thing the renter heard from us; the SLA clock runs from here.
  const delivered = opts.events
    .filter(e => e.type === 'ITINERARY_DELIVERED')
    .map(e => Date.parse(e.occurred_at))
    .sort((a, b) => b - a)[0] ?? null;
  const ageSeconds = Math.max(0, (opts.now - Date.parse(opts.createdAt)) / 1000);
  const t = triage(view, ageSeconds, delivered, opts.now, waitingReplies(opts.events).length);
  const proposals = opts.proposals ?? 0;
  return {
    kind: 'VIEWING',
    id: opts.id,
    name: opts.ref,
    state: view.state,
    waitingOn: proposals > 0 && t.actionable ? `${t.waitingOn} · ${proposals} AI proposal${proposals === 1 ? '' : 's'}` : t.waitingOn,
    urgency: t.urgency,
    rank: t.rank,
    actionable: t.actionable,
    createdAt: opts.createdAt,
    dueAt: null,
    proposals,
  };
}

function inquiryUrgency(view: InquiryView, now: number): Urgency {
  const due = inquiryDeadline(view);
  if (!due || view.state === 'CLOSED') return 'OK';
  const left = Date.parse(due) - now;
  return left <= 0 ? 'LATE' : left < 8 * 3_600_000 ? 'WARN' : 'OK';
}

export function inquiryInboxRow(opts: {
  id: string;
  name: string;
  /** An area, not a building: Priority search. */
  isSearch: boolean;
  createdAt: string;
  events: InquiryEvent[];
  lastRenterAt: string | null;
  lastOursAt: string | null;
  now: number;
}): InboxRow {
  const view = reduceInquiry(opts.id, opts.events);
  const u = inquiryUrgency(view, opts.now);
  const agents = Object.values(view.agents);
  const asked = agents.filter(a => a.askedAt).length;
  const withUnits = agents.filter(a => a.answer === 'HAS_UNITS').length;
  const renterWaiting = !!opts.lastRenterAt && (!opts.lastOursAt || opts.lastRenterAt > opts.lastOursAt);
  const base = {
    kind: (opts.isSearch ? 'SEARCH' : 'BUILDING') as InboxKind,
    id: opts.id,
    name: opts.name,
    state: view.state,
    urgency: u,
    createdAt: opts.createdAt,
    dueAt: view.state === 'NEW' || view.state === 'SOURCING' ? inquiryDeadline(view) : null,
    proposals: 0,
  };

  if (view.state === 'CLOSED') {
    return { ...base, rank: 900, actionable: false, waitingOn: `Closed - ${(view.closedReason ?? 'OTHER').toLowerCase().replace(/_/g, ' ')}` };
  }
  if (view.state === 'AWAITING_CODE') {
    return { ...base, rank: 800, actionable: false, waitingOn: 'Form sent, WhatsApp code not yet' };
  }
  if (renterWaiting) {
    return { ...base, rank: URGENCY_RANK[u], actionable: true, waitingOn: 'Renter replied - waiting on us' };
  }
  if (view.state === 'NEW') {
    return { ...base, rank: URGENCY_RANK[u], actionable: true, waitingOn: 'Nobody asked yet - ask the agents' };
  }
  if (view.state === 'SOURCING') {
    return {
      ...base, rank: URGENCY_RANK[u] + 1, actionable: true,
      waitingOn: withUnits > 0
        ? `${withUnits} agent${withUnits === 1 ? '' : 's'} with units - capture and offer them`
        : `${asked} agent${asked === 1 ? '' : 's'} asked, no units yet`,
    };
  }
  // OFFERED: the renter has the units and the next word is theirs.
  return { ...base, urgency: 'OK', rank: 50, actionable: false, waitingOn: 'Units sent - waiting on the renter' };
}

/** Most urgent first; at the same rank, the oldest. */
export function sortInbox(rows: InboxRow[]): InboxRow[] {
  return [...rows].sort((a, b) => a.rank - b.rank || a.createdAt.localeCompare(b.createdAt));
}
