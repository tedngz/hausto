// The AI operator's judgement, stage 1 (shadow): what should happen next on a
// request, as typed actions a person can approve.
//
// Most of an operator's day is not interpretation. An uncontacted agent with a
// number gets the first message; a quiet one gets chased after six hours and
// closed as NO_RESPONSE after two chases; a request whose agents have all
// answered gets its itinerary; a broker holding time for a request that closed
// gets told. Those follow from the log, so they are decided here, by rules
// that are pure and tested - not by a model asked to rediscover them on every
// call and able to get them wrong in new ways each time.
//
// A model enters only where something has to be read: an agent's reply, read
// by paste-parse (parse-reply.ts) before the planner runs and handed in as a
// suggestion. Anything the rules cannot settle - a renter's question, a unit
// with no agent number, a reply that says nothing - becomes ESCALATE: a
// proposal that a person should handle it, which is itself a judgement the
// shadow period measures.
//
// Nothing here writes. Proposals are rows an operator approves (running the
// action under their own OPS:<uuid>), corrects, or rejects.

import { summarise, type DomainEvent, type RequestView } from '../viewing-domain.ts';
import { realtorDecisionsOwed, NUDGE_AFTER_MS } from './reminders.ts';
import { waitingReplies } from './thread.ts';
import { NUDGES_BEFORE_NO_RESPONSE } from './outcomes.ts';
import { assembleItinerary, busySlots, clashesWith, freeOnOtherDays, type BusySlot } from './itinerary.ts';
import { draftForRealtor, nudgeDraft, confirmDraft, releaseDraft, clashDraft } from '../realtor/drafts.ts';
import type { ParseSuggestion } from './parse-reply.ts';
import type { DraftResult } from './renter-reply.ts';
import { DAY_PART_HOURS, type DayPart } from './intake.ts';

/** Stamped on every proposal, so agreement can be compared across versions. */
export const AGENT_VERSION = 'shadow-v1';

export const PROPOSED_ACTIONS = [
  'CONTACTED', 'NUDGE', 'OUTCOME', 'NOTIFY_REALTOR', 'DELIVER', 'CANCEL_REQUEST', 'REPLY', 'ESCALATE',
] as const;
export type ProposedAction = typeof PROPOSED_ACTIONS[number];

export interface PlanItem {
  itemId: string;
  listingTitle: string;
  listingUrl: string | null;
  districtCode: string | null;
  priceVnd: number;
  /** Whether a dialable agent number is resolved. The number itself is not needed here. */
  hasContact: boolean;
}

/** An agent reply stored after the item's last outcome - read by nobody yet. */
export interface UnreadReply {
  itemId: string;
  messageId: string;
  /** Null when the parser could not be asked (no budget, model down). */
  suggestion: ParseSuggestion | null;
}

export interface PlanInput {
  requestId: string;
  view: RequestView;
  events: DomainEvent[];
  items: PlanItem[];
  availability: { date: string; part: string }[];
  unreadReplies: UnreadReply[];
  /** A drafted answer to the renter's newest waiting reply, if one was attempted. */
  renterDraft?: RenterDraft;
  /**
   * Confirmations proposed on an earlier run and not yet recorded. A later
   * agent's time is checked against them as well as the recorded ones.
   */
  proposedSlots?: BusySlot[];
  now: number;
}

export interface RenterDraft {
  /** The newest waiting reply the draft answers. A newer message makes it stale. */
  messageId: string;
  /** Null when the model could not be asked. */
  draft: DraftResult | null;
  /** Why nothing may be sent right now: the window is shut, they opted out, two already sent. */
  blocked?: string;
}

export interface Proposal {
  requestId: string;
  itemId: string | null;
  /** One proposal per situation, ever - see the migration. */
  key: string;
  action: ProposedAction;
  /** The ops action's input, minus `action`. Approving runs exactly this. */
  input: Record<string, unknown>;
  rationale: string;
  confidence: 'HIGH' | 'LOW';
}

const CLOSED = new Set(['CONFIRMED', 'CANCELLED', 'FAILED_NO_SUPPLY']);

function lastTouch(events: DomainEvent[], itemId: string): number | null {
  let last: number | null = null;
  for (const e of events) {
    if (e.item_id !== itemId || (e.type !== 'REALTOR_CONTACTED' && e.type !== 'ITEM_NUDGED')) continue;
    const t = Date.parse(e.occurred_at);
    if (last == null || t > last) last = t;
  }
  return last;
}

const hours = (ms: number) => Math.floor(ms / 3_600_000);

/**
 * Has every window the renter gave already ended, in Ho Chi Minh City time?
 * No windows at all is not "passed" - the first message then asks the agent
 * for any time that week.
 */
export function windowsAllPassed(availability: { date: string; part: string }[], now: number): boolean {
  if (availability.length === 0) return false;
  return availability.every(w => windowEnded(w, now));
}

function windowEnded(w: { date: string; part: string }, now: number): boolean {
  const to = DAY_PART_HOURS[w.part as DayPart]?.to ?? 23;
  const end = Date.parse(`${w.date}T${String(to).padStart(2, '0')}:00:00+07:00`);
  return Number.isFinite(end) && end <= now;
}

/** `09:30 Tue 14/10` in Ho Chi Minh City, for a rationale a person reads. */
function hcmcShort(iso: string): string {
  const local = new Date(Date.parse(iso) + 7 * 3_600_000).toISOString();
  return `${local.slice(11, 16)} on ${local.slice(8, 10)}/${local.slice(5, 7)}`;
}

export function planRequest(p: PlanInput): Proposal[] {
  const out: Proposal[] = [];
  const { view, requestId } = p;
  const closed = CLOSED.has(view.state);
  const propose = (x: Omit<Proposal, 'requestId' | 'confidence'> & { confidence?: 'HIGH' | 'LOW' }) =>
    out.push({ requestId, confidence: 'HIGH', ...x });

  // ── The renter ─────────────────────────────────────────────────────────────
  // Every reply that is not a yes or a stop routes to a person (intent.ts). A
  // decline proposes ending the request; anything else proposes a drafted
  // answer for the person to approve, or escalates when there is no safe
  // draft. Keyed on the newest reply, so a new message is a new proposal.
  const waiting = waitingReplies(p.events);
  if (waiting.length > 0) {
    const newest = waiting[waiting.length - 1];
    const key = `RENTER:${newest.messageId ?? newest.at}`;
    if (waiting.some(w => w.intent === 'DECLINE') && view.state !== 'CANCELLED') {
      propose({
        itemId: null, key, action: 'CANCEL_REQUEST',
        input: { requestId, reason: 'RENTER_DECLINED' },
        rationale: 'The renter declined. Cancelling releases every agent still holding time for them.',
        // A decline classified by keywords can be "no, the second one is too
        // far" - a person should read it before the request is ended.
        confidence: 'LOW',
      });
    } else {
      // A drafted answer, when one was made for exactly this reply and the
      // renter can legally be sent it. The draft was checked against the same
      // rules as an operator's own reply before it got here (renter-reply.ts).
      const d = p.renterDraft;
      const clientKey = newest.messageId ? `reply-${newest.messageId}` : null;
      if (d && clientKey && d.messageId === newest.messageId && !d.blocked && d.draft?.kind === 'DRAFT') {
        propose({
          itemId: null, key, action: 'REPLY',
          input: { requestId, message: d.draft.message, clientKey },
          rationale: d.draft.needsAgent
            ? `Drafted a reply that promises to check with the agent - you still have to ask them. ${d.draft.note}`.trim()
            : `Drafted an answer from the listing and request. ${d.draft.note}`.trim(),
          confidence: d.draft.confidence,
        });
      } else {
        const why = d?.blocked ?? (d?.draft?.kind === 'ESCALATE' ? d.draft.reason : null);
        propose({
          itemId: null, key, action: 'ESCALATE',
          input: { requestId, reason: 'RENTER_REPLY', intents: waiting.map(w => w.intent) },
          rationale: `The renter wrote ${waiting.length === 1 ? 'a reply' : `${waiting.length} replies`} `
            + `(${waiting.map(w => w.intent.toLowerCase()).join(', ')}) that ${waiting.length === 1 ? 'needs' : 'need'} a person.`
            + (why ? ` No draft: ${why}` : ''),
        });
      }
    }
  }

  // ── Brokers owed the renter's decision ─────────────────────────────────────
  for (const owed of realtorDecisionsOwed(view)) {
    const item = p.items.find(i => i.itemId === owed.itemId);
    if (!item) continue;
    const slot = (view.items[owed.itemId]?.slots[0] as { starts_at?: string } | undefined)?.starts_at ?? null;
    propose({
      itemId: owed.itemId, key: `NOTIFY:${owed.itemId}:${owed.decision}`, action: 'NOTIFY_REALTOR',
      input: {
        itemId: owed.itemId, decision: owed.decision, channel: 'ZALO',
        message: owed.decision === 'CONFIRM'
          ? confirmDraft({ listingTitle: item.listingTitle, startsAt: slot })
          : releaseDraft({ listingTitle: item.listingTitle }),
      },
      rationale: owed.decision === 'CONFIRM'
        ? 'The renter kept this viewing; the agent has not been told to hold the time.'
        : view.items[owed.itemId]?.state === 'WITHDRAWN'
          ? 'The renter removed this place; the agent is still holding time for it.'
          : `The request is ${view.state.toLowerCase()}; the agent is still holding time for it.`,
    });
  }

  if (closed) return out;

  // Every time the renter offered is over. Asking an agent about a morning
  // that has gone - or chasing them about it - is a message nobody can act
  // on, and one that may now go out with no person reading it first. The
  // renter needs asking for new times, and that is a person's job.
  const stale = windowsAllPassed(p.availability, p.now);
  if (stale && Object.values(view.items).some(i => i.state === 'PENDING' || i.state === 'CONTACTED')) {
    propose({
      itemId: null, key: `STALE_WINDOWS:${requestId}`, action: 'ESCALATE',
      input: { requestId, reason: 'WINDOWS_PASSED' },
      rationale: 'Every time the renter gave has passed. Ask them for new times before any agent is contacted or chased.',
    });
  }

  // ── Each broker ────────────────────────────────────────────────────────────
  // The viewings already fixed, and the ones this run is about to fix. A time
  // that overlaps one of them is caught as the agent gives it, while they can
  // still be asked for another - not once every agent has answered and the
  // plan cannot go out.
  const titleOf = (id: string) => p.items.find(i => i.itemId === id)?.listingTitle ?? 'another place';
  const busy: BusySlot[] = [
    ...busySlots(view, titleOf),
    ...(p.proposedSlots ?? []).filter(s => view.items[s.itemId]?.state !== 'CONFIRMED'),
  ];

  for (const item of p.items) {
    const state = view.items[item.itemId];
    if (!state) continue;
    // New times send an agent back to be asked again (AVAILABILITY_CHANGED).
    // Each round's proposals are new ones, not the first round's again.
    const round = state.round > 0 ? `:r${state.round}` : '';

    // A reply nobody has read outranks everything else about this item.
    const unread = p.unreadReplies.filter(r => r.itemId === item.itemId).pop();
    if (unread) {
      const s = unread.suggestion;
      const key = `OUTCOME:${item.itemId}:${unread.messageId}`;
      // A confirmed time is kept only where it misses the viewings already
      // fixed. When every time they gave clashes, they are asked for another.
      const free = s?.outcome === 'CONFIRMED'
        ? s.slots.filter(x => clashesWith(x, busy, item.itemId).length === 0)
        : s?.slots ?? [];
      if (s?.outcome === 'CONFIRMED' && s.problems.length === 0 && s.slots.length > 0 && free.length === 0) {
        const offered = s.slots[0];
        const taken = clashesWith(offered, busy, item.itemId);
        const several = s.slots.length > 1;
        propose({
          itemId: item.itemId, key, action: 'CONTACTED',
          input: {
            itemId: item.itemId, channel: 'ZALO',
            message: clashDraft({
              listingTitle: item.listingTitle, offered: offered.startsAt, taken,
              availability: p.availability.filter(w => !windowEnded(w, p.now)),
            }),
          },
          rationale: `The agent can do ${s.slots.map(x => hcmcShort(x.startsAt)).join(' or ')}, `
            + `${several ? 'all of which clash' : 'which clashes'} with `
            + `${[...new Set(taken.map(t => t.listingTitle))].join(' and ')}. Ask them for another time now.`,
          confidence: s.confidence,
        });
        continue;
      }
      if (s?.outcome && s.problems.length === 0) {
        const slots = free;
        const dropped = s.slots.filter(x => !slots.includes(x));
        if (s.outcome === 'CONFIRMED' && slots[0]) {
          busy.push({ itemId: item.itemId, listingTitle: item.listingTitle, ...slots[0] });
        }
        propose({
          itemId: item.itemId, key, action: 'OUTCOME',
          input: {
            itemId: item.itemId, outcome: s.outcome, slots,
            ...(s.actualPriceVnd != null ? { actualPriceVnd: s.actualPriceVnd } : {}),
            note: s.note, suggested: s,
          },
          rationale: `The agent replied: ${s.note || 'see the conversation'}.`
            + (dropped.length > 0
              ? ` Left out ${dropped.map(x => hcmcShort(x.startsAt)).join(', ')}: `
                + `${dropped.length > 1 ? 'they clash' : 'it clashes'} with another viewing.`
              : ''),
          confidence: s.confidence,
        });
      } else {
        propose({
          itemId: item.itemId, key, action: 'ESCALATE',
          input: { itemId: item.itemId, reason: 'UNREAD_REPLY' },
          rationale: s
            ? `The agent replied but it could not be settled: ${[s.note, ...s.problems].filter(Boolean).join(' ')}`
            : 'The agent replied and the reply could not be read automatically.',
          confidence: 'LOW',
        });
      }
      continue;
    }

    // Replies are still read above; nothing new goes out on dead dates.
    if (stale) continue;

    if (state.state === 'PENDING') {
      // Asked before, about times the renter has since changed: the message
      // says the times changed. A round counted on an agent nobody had asked
      // yet is just a first ask.
      const reask = state.round > 0
        && p.events.some(e => e.item_id === item.itemId && e.type === 'REALTOR_CONTACTED');
      if (item.hasContact) {
        propose({
          itemId: item.itemId, key: `CONTACT:${item.itemId}${round}`, action: 'CONTACTED',
          input: {
            itemId: item.itemId, channel: 'ZALO',
            message: draftForRealtor({
              listingTitle: item.listingTitle, listingUrl: item.listingUrl,
              priceVnd: item.priceVnd, availability: p.availability,
              rescheduled: reask,
            }),
          },
          rationale: reask
            ? 'The renter changed their times. Ask this agent about the new ones.'
            : 'Nobody has asked this agent yet. Send the first message.',
        });
      } else {
        propose({
          itemId: item.itemId, key: `NO_CONTACT:${item.itemId}${round}`, action: 'ESCALATE',
          input: { itemId: item.itemId, reason: 'NO_CONTACT' },
          rationale: 'No working number for this agent. A person has to find one.',
        });
      }
      continue;
    }

    if (state.state === 'CONTACTED') {
      const last = lastTouch(p.events, item.itemId);
      if (last == null || p.now - last < NUDGE_AFTER_MS) continue;
      if (state.nudges < NUDGES_BEFORE_NO_RESPONSE) {
        propose({
          itemId: item.itemId, key: `NUDGE:${item.itemId}${round}:${state.nudges + 1}`, action: 'NUDGE',
          input: { itemId: item.itemId, channel: 'ZALO', message: nudgeDraft({ listingTitle: item.listingTitle }) },
          rationale: `No reply in ${hours(p.now - last)}h. Chase #${state.nudges + 1}.`,
        });
      } else {
        propose({
          itemId: item.itemId, key: `NO_RESPONSE:${item.itemId}${round}`, action: 'OUTCOME',
          input: { itemId: item.itemId, outcome: 'NO_RESPONSE', note: `Silent ${hours(p.now - last)}h after ${state.nudges} chases.` },
          rationale: `Chased ${state.nudges} times and silent ${hours(p.now - last)}h since. Close it so the renter can hear about the rest.`,
        });
      }
    }
  }

  // ── The itinerary ─────────────────────────────────────────────────────────
  // Once every agent has answered, and only once: the renter hears the plan
  // one time. Ordered by the clock - the rules warn about the orderings that
  // are wrong. A clash is caught as each agent answers (above); one that gets
  // this far anyway is a person's to fix.
  const s = summarise(view);
  // A held plan has been sent as far as it can go; the renter's reply
  // releases it (deliver.ts), not another proposal. Asked for other days,
  // the next move is the renter's too - unless the answer has changed since,
  // as when a place that joined was confirmed.
  const waitingOnDays = !!view.otherDaysAsked && s.confirmed === 0
    && !Object.values(view.items).some(i => i.state === 'ALTERNATIVE_OFFERED');
  if (!view.deliveredMessageId && !view.heldItinerary && !waitingOnDays && s.total > 0 && s.unresolved === 0) {
    const byTime = Object.values(view.items)
      .filter(i => i.state === 'CONFIRMED')
      .map(i => ({ id: i.itemId, at: (i.slots[0] as { starts_at?: string } | undefined)?.starts_at ?? '' }))
      .sort((a, b) => (a.at < b.at ? -1 : 1))
      .map(x => x.id);
    const assembled = assembleItinerary(
      view,
      p.items.map(i => ({
        itemId: i.itemId, listingTitle: i.listingTitle, districtCode: i.districtCode, priceVndAtRequest: i.priceVnd,
      })),
      byTime,
    );
    const clash = assembled.warnings.find(w => w.kind === 'OVERLAP');
    // The same branches as deliver.ts, so the rationale says what will go.
    const busyOnly = s.confirmed === 0 && assembled.alternatives.length === 0
      ? freeOnOtherDays(view, p.items.map(i => ({
        itemId: i.itemId, listingTitle: i.listingTitle, districtCode: i.districtCode, priceVndAtRequest: i.priceVnd,
      }))).length
      : 0;
    // Asking for other days is its own decision, so a plan that follows it -
    // a place joined and was confirmed - is proposed rather than taken for
    // the same one. New times are a new round of answers, and a new decision.
    const key = `DELIVER:${requestId}${busyOnly > 0 ? ':days' : ''}`
      + `${view.availabilityChanges > 0 ? `:t${view.availabilityChanges}` : ''}`;
    if (clash) {
      propose({
        itemId: null, key, action: 'ESCALATE',
        input: { requestId, reason: 'ITINERARY_CLASH' },
        rationale: `Every agent has answered, but two viewings clash: ${clash.message}`,
      });
    } else {
      propose({
        itemId: null, key, action: 'DELIVER',
        input: { requestId, order: byTime },
        rationale: s.confirmed > 0
          ? `Every agent has answered: ${s.confirmed} of ${s.total} confirmed. Send the plan.`
          : assembled.alternatives.length > 0
            ? 'Every agent has answered: none is free at the renter\'s times, but some offered others. Send them.'
            : busyOnly > 0
              ? `Every agent has answered and none can do the renter's days, but ${busyOnly === 1 ? 'one place has' : `${busyOnly} places have`} not been rented. Ask the renter for other days.`
              : 'Every agent has answered and nothing is left. Tell the renter, with close matches or Priority search.',
        confidence: assembled.warnings.length > 0 ? 'LOW' : 'HIGH',
      });
    }
  }

  return out;
}
