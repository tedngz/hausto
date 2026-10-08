// What a renter can change about their own request, from the hub's Viewings
// tab (2026-10-08): take a place out, give new times, or call it off. Adding
// places is the request modal's join (intake.ts pickJoinable), not this.
//
// The same rules as everything else in the domain. Each change is an event
// (invariant 1): ITEM_WITHDRAWN, AVAILABILITY_CHANGED, and for calling it off
// the console's own CANCEL_REQUEST under the actor RENTER, so there is one
// implementation of what ending a request does to its agents. Nothing here
// messages an agent. A removed place makes its agent owed a release, new
// times make every agent owed a new ask (reminders.ts, planner.ts), and the
// operator - a person or the AI operator - sends those like any other.
//
// What it does stop is an ask still sitting in the Zalo bridge's outbox: a
// message about a place the renter removed, or about times they no longer
// want, is never sent rather than sent and then taken back.
//
// The renter hears it on WhatsApp too, in one line, while their window is
// open - the thread is where the rest of the request lives, and the next
// person to read it should find the change there. With the window shut, or
// after two unanswered messages, nothing is sent: the change is on the page
// they made it on, and a template saying so would be a billed message telling
// them what they just did. Operators are emailed every change.

import { reduceRequest, type DomainEvent, type RequestView } from '../viewing-domain.ts';
import { performOpsAction, type OpsDeps } from './ops-actions.ts';
import { canChangeTimes, canRemovePlace, stillOpen } from './renter-view.ts';
import { validateAvailability, type AvailabilityWindow } from './intake.ts';
import { hcmcDate } from './format.ts';
import { CONSOLE_URL, type IntakeAlert } from './ops-alert.ts';
import { sendFreeForm } from '../whatsapp/send.ts';

// deno-lint-ignore no-explicit-any
type Supa = any;

/** Who a renter's own change is written as. */
export const RENTER_ACTOR = 'RENTER';

export type RenterEdit =
  | { kind: 'REMOVE_PLACE'; itemId: string }
  | { kind: 'CHANGE_TIMES'; availability: unknown }
  | { kind: 'CANCEL'; reason: 'RENTER_FOUND_PLACE' | 'RENTER_DECLINED' };

export interface RequestRow {
  id: string;
  ref: string;
  renter_id: string;
  availability: unknown;
}

export type EditResult =
  | { ok: true; recorded: string; whatsapp: 'SENT' | 'NOT_SENT'; alert: IntakeAlert }
  | { ok: false; status: number; error: string; message: string };

const refuse = (status: number, error: string, message: string): EditResult => ({ ok: false, status, error, message });

const PART: Record<string, string> = { MORNING: 'morning', AFTERNOON: 'afternoon', EVENING: 'evening' };

/** `Sat 17 Oct morning, Sun 18 Oct afternoon` - the renter's windows in words. */
export function describeWindows(windows: AvailabilityWindow[]): string {
  return windows.map(w => {
    const d = new Date(`${w.date}T12:00:00Z`);
    const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    return `${day} ${PART[w.part] ?? w.part.toLowerCase()}`;
  }).join(', ');
}

async function loadView(db: Supa, requestId: string): Promise<RequestView> {
  const { data } = await db
    .from('events').select('id, request_id, item_id, type, payload, actor, occurred_at')
    .eq('request_id', requestId).order('occurred_at', { ascending: true });
  return reduceRequest(requestId, (data ?? []) as DomainEvent[]);
}

/**
 * Asks and chasers still waiting in the bridge's outbox, for these places or
 * the whole request. Unclaimed only: one the device has picked up may already
 * be on its way, and its ack writes the event as for any message.
 */
async function stopQueuedAsks(db: Supa, requestId: string, itemIds: string[] | null, why: string): Promise<void> {
  let q = db.from('realtor_messages')
    .update({ status: 'FAILED', error: why })
    .eq('request_id', requestId)
    .eq('direction', 'OUT')
    .eq('status', 'QUEUED')
    .is('claimed_at', null)
    .in('purpose', ['REQUEST_VIEWING', 'NUDGE']);
  if (itemIds) q = q.in('item_id', itemIds);
  const { error } = await q;
  if (error) console.error('[renter-edits] stopping queued asks failed:', error);
}

async function completeJobs(db: Supa, kinds: string[], itemIds: string[]): Promise<void> {
  for (const itemId of itemIds) {
    for (const kind of kinds) {
      await db.from('jobs')
        .update({ completed_at: new Date().toISOString() })
        .eq('kind', kind)
        .is('completed_at', null)
        .eq('payload->>item_id', itemId);
    }
  }
}

/**
 * The one line on WhatsApp. Best effort: a shut window, two unanswered
 * messages or an opted-out number all mean no message, and the change stands.
 */
async function tellRenter(
  db: Supa,
  deps: OpsDeps,
  request: RequestRow,
  key: string,
  body: string,
): Promise<'SENT' | 'NOT_SENT'> {
  try {
    const sent = await sendFreeForm(deps.messages, deps.whatsapp, {
      renterId: request.renter_id,
      requestId: request.id,
      purpose: `RENTER_EDIT:${key}`,
      body,
    });
    if (sent.message.status === 'FAILED') return 'NOT_SENT';
    if (!sent.deduplicated) {
      // Something the renter heard that was not the plan: it moves the
      // silence clock and nothing else (SPEC §9).
      await db.from('events').insert({
        request_id: request.id,
        type: 'HOLDING_UPDATE_SENT',
        payload: { message_id: sent.message.id, purpose: 'RENTER_EDIT' },
        actor: 'SYSTEM',
      });
    }
    return 'SENT';
  } catch (e) {
    console.log(`[renter-edits] ${request.ref}: no WhatsApp line (${(e as Error).name})`);
    return 'NOT_SENT';
  }
}

function alertFor(ref: string, headline: string, lines: string[]): IntakeAlert {
  return {
    subject: `${ref} - ${headline}`,
    text: [...lines, '', `Open the queue: ${CONSOLE_URL}`].join('\n'),
  };
}

/** A caller's idempotency key, or one made here. */
function editKey(v: unknown): string {
  const k = typeof v === 'string' ? v.trim() : '';
  return /^[A-Za-z0-9-]{8,64}$/.test(k) ? k : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export async function applyRenterEdit(
  db: Supa,
  deps: OpsDeps,
  request: RequestRow,
  edit: RenterEdit,
  opts: { now: number; clientKey?: unknown },
): Promise<EditResult> {
  const view = await loadView(db, request.id);
  const key = editKey(opts.clientKey);

  if (edit.kind === 'REMOVE_PLACE') {
    const it = view.items[edit.itemId];
    if (!it) return refuse(404, 'unknown_place', 'That place is not in this request.');
    if (it.state === 'WITHDRAWN') return refuse(409, 'already_removed', 'That place is already out of this request.');
    if (!canRemovePlace(view, edit.itemId, opts.now)) {
      const others = Object.values(view.items).filter(i => i.state !== 'WITHDRAWN' && i.itemId !== edit.itemId);
      return others.length === 0 || view.state === 'CONFIRMED'
        ? refuse(409, 'last_place', 'This is the last place in the request. Cancel the request instead.')
        : refuse(409, 'cannot_remove', 'This place can no longer be taken out.');
    }
    const { data: row } = await db
      .from('ops_request_items_view').select('id, listing_title').eq('id', edit.itemId).maybeSingle();
    const title = String(row?.listing_title ?? 'That place');
    const { error } = await db.from('events').insert({
      request_id: request.id, item_id: edit.itemId, type: 'ITEM_WITHDRAWN', payload: {}, actor: RENTER_ACTOR,
    });
    if (error) return refuse(500, 'event_failed', 'Something went wrong on our side. Try again in a moment.');
    await stopQueuedAsks(db, request.id, [edit.itemId], 'superseded: the renter removed this place');
    await completeJobs(db, ['NUDGE_REALTOR', 'RESOLVE_REALTOR', 'CONFIRM_REALTOR'], [edit.itemId]);

    const left = Object.values(view.items).filter(i => i.state !== 'WITHDRAWN' && i.itemId !== edit.itemId).length;
    const whatsapp = await tellRenter(db, deps, request, key,
      `Done - ${title} is out of ${request.ref}. ${left === 1 ? '1 place' : `${left} places`} left in it.`);
    return {
      ok: true, recorded: 'ITEM_WITHDRAWN', whatsapp,
      alert: alertFor(request.ref, 'renter removed a place', [
        `The renter took ${title} out of ${request.ref} on the web. ${left} left.`,
        it.state === 'PENDING'
          ? 'Its agent had not been asked yet; any ask still queued for them has been stopped.'
          : 'Its agent is owed a release - it is on the to-do list.',
      ]),
    };
  }

  if (edit.kind === 'CHANGE_TIMES') {
    if (!canChangeTimes(view)) {
      return refuse(409, 'times_fixed',
        'The agents have answered and your plan is being put together, so the times are set. Tell us on WhatsApp if they no longer work.');
    }
    const today = hcmcDate(new Date(opts.now));
    const v = validateAvailability(edit.availability, today);
    if (!v.ok || !v.value) return refuse(400, 'invalid_times', v.error ?? 'Pick at least one time.');
    const previous = Array.isArray(request.availability) ? request.availability as AvailabilityWindow[] : [];
    const same = previous.length === v.value.length
      && previous.every((w, i) => w.date === v.value![i].date && w.part === v.value![i].part);
    if (same) return refuse(409, 'same_times', 'Those are the times we already have.');

    // The column is what every reader asks agents about - the planner's
    // drafts, paste-parse, the console - so it carries the current windows;
    // the event carries the change, and what it undoes (viewing-domain.ts).
    const { error: upErr } = await db.from('viewing_requests').update({ availability: v.value }).eq('id', request.id);
    if (upErr) return refuse(500, 'write_failed', 'Something went wrong on our side. Try again in a moment.');
    const { error } = await db.from('events').insert({
      request_id: request.id, type: 'AVAILABILITY_CHANGED',
      payload: { availability: v.value, previous }, actor: RENTER_ACTOR,
    });
    if (error) {
      await db.from('viewing_requests').update({ availability: previous }).eq('id', request.id);
      return refuse(500, 'event_failed', 'Something went wrong on our side. Try again in a moment.');
    }
    await stopQueuedAsks(db, request.id, null, 'superseded: the renter changed their times');
    await completeJobs(db, ['NUDGE_REALTOR'], Object.keys(view.items));

    const asked = Object.values(view.items).filter(i => i.state !== 'PENDING' && i.state !== 'WITHDRAWN'
      && i.state !== 'ALREADY_RENTED' && i.state !== 'PRICE_CHANGED' && i.state !== 'UNREACHABLE').length;
    const whatsapp = await tellRenter(db, deps, request, key,
      `Done - ${request.ref} now asks for ${describeWindows(v.value)}. We are asking the agents about the new times.`);
    return {
      ok: true, recorded: 'AVAILABILITY_CHANGED', whatsapp,
      alert: alertFor(request.ref, 'renter changed their times', [
        `The renter on ${request.ref} changed their times on the web.`,
        `Was: ${describeWindows(previous) || 'not stated'}.`,
        `Now: ${describeWindows(v.value)}.`,
        asked > 0
          ? `${asked === 1 ? '1 agent was' : `${asked} agents were`} asked about the old times and ${asked === 1 ? 'needs' : 'need'} asking again.`
          : 'No agent had been asked yet.',
      ]),
    };
  }

  // CANCEL: the console's own action, as the renter.
  if (!stillOpen(view, opts.now)) {
    return refuse(409, 'closed', view.state === 'CANCELLED' ? 'This request is already cancelled.' : 'This request is finished.');
  }
  const r = await performOpsAction(db, deps, RENTER_ACTOR, {
    action: 'CANCEL_REQUEST', requestId: request.id, reason: edit.reason,
  });
  if (r.status !== 200) {
    return refuse(r.status, String(r.body.error ?? 'cancel_failed'), String(r.body.message ?? 'Could not cancel the request.'));
  }
  await stopQueuedAsks(db, request.id, null, 'superseded: the renter cancelled the request');
  const whatsapp = await tellRenter(db, deps, request, key,
    `Done - ${request.ref} is cancelled, and we will let the agents know. You can ask for new viewings on hausto.com any time.`);
  return {
    ok: true, recorded: 'REQUEST_CANCELLED', whatsapp,
    alert: alertFor(request.ref, 'renter cancelled', [
      `The renter cancelled ${request.ref} on the web (${edit.reason === 'RENTER_FOUND_PLACE' ? 'found a place' : 'no reason given'}).`,
      'Every agent still holding time is owed a release - they are on the to-do list.',
    ]),
  };
}
