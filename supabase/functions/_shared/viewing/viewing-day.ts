// The viewing-day message: on the morning of a confirmed viewing, where to go,
// who to meet, and - if the agent agreed - their number (SPEC §6).
//
// It replaced the day-before reminder, which named the flat and the time and
// nothing else: no address, no meeting point, and no way to reach anyone but
// us. A renter lost in a Vinhomes car park at 09:55 needs the agent, not a
// thread an operator reads when they next look.
//
// Invariant 4 still holds everywhere else. A realtor's number reaches a renter
// here and nowhere else, only for a viewing the renter said yes to, only on its
// day, and only when the agent agreed to it (`share_phone`). By then they are
// about to meet in person; hiding the number any earlier is what stops a renter
// going round us, and it stays hidden until then. `dayStops` is the one
// function that reads a realtor's number for renter output, and
// `sendViewingDay` loads numbers only for the agents that said yes.
//
// One message per renter per day, whatever number of requests or viewings:
// three viewings on a Saturday used to be three reminders, and the third was a
// ConsecutiveMessageError.

import type { WhatsAppAdapter } from '../whatsapp/adapter.ts';
import { SupabaseMessageStore } from '../whatsapp/store.ts';
import {
  sendFreeForm,
  sendTemplate,
  isWindowOpen,
  ConsecutiveMessageError,
  UnapprovedTemplateError,
} from '../whatsapp/send.ts';
import { TEMPLATES } from '../whatsapp/templates.ts';
import { reduceRequest, type DomainEvent, type RequestView, type ViewingDetails } from '../viewing-domain.ts';
import { containsInternationalNumber, containsPhoneNumber } from './privacy.ts';
import { hcmcDate, hcmcTime } from './format.ts';

// deno-lint-ignore no-explicit-any
type Supa = any;

const HOUR_MS = 60 * 60 * 1000;

/** The message goes at 07:00 in Ho Chi Minh City on the day... */
export const VIEWING_DAY_SEND_HOUR = 7;
/** ...or this long before the first viewing, if that is earlier. */
export const VIEWING_DAY_LEAD_MS = 2 * HOUR_MS;

export const MEETING_POINT_MAX = 200;
export const AGENT_NAME_MAX = 40;

/** Collapsed to one line: it is printed in a message and passed as a template parameter. */
function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export type DetailsCheck = { ok: true; value: ViewingDetails } | { ok: false; error: string };

/**
 * An operator's entry of what the agent said: where to meet, their first
 * name, and whether their number may go to the renter on the day.
 *
 * No number is accepted in the free text. The only number the renter gets is
 * the agent's own, read from their contact and only with their consent - an
 * operator typing one into the meeting point would be both unconsented and
 * possibly the wrong person's.
 */
export function validateViewingDetails(raw: Record<string, unknown>): DetailsCheck {
  const meetingPoint = oneLine(String(raw.meetingPoint ?? ''));
  if (meetingPoint.length < 3) {
    return { ok: false, error: 'Say where to meet: the tower, the lobby, the gate - with the address.' };
  }
  if (meetingPoint.length > MEETING_POINT_MAX) {
    return { ok: false, error: `Keep the meeting point under ${MEETING_POINT_MAX} characters.` };
  }
  const name = oneLine(String(raw.agentFirstName ?? ''));
  if (name.length > AGENT_NAME_MAX) return { ok: false, error: `Keep the agent's name under ${AGENT_NAME_MAX} characters.` };
  if (/\d/.test(name)) return { ok: false, error: "Just the agent's first name - no numbers." };
  for (const text of [meetingPoint, name]) {
    if (containsPhoneNumber(text) || containsInternationalNumber(text)) {
      return {
        ok: false,
        error: "Leave phone numbers out. The agent's own number goes in by itself, if they agreed to share it.",
      };
    }
  }
  if (typeof raw.sharePhone !== 'boolean') {
    return { ok: false, error: 'Say whether the agent agreed to their number going to the renter on the day.' };
  }
  return { ok: true, value: { meetingPoint, agentFirstName: name || null, sharePhone: raw.sharePhone } };
}

export interface KeptViewing {
  itemId: string;
  startsAt: string;
  /** Its Ho Chi Minh City date, `YYYY-MM-DD`. */
  date: string;
}

/**
 * The viewings the renter said yes to: kept in REQUEST_CONFIRMED, confirmed by
 * the agent, and with a time. Nothing at all unless the request is CONFIRMED -
 * a delivered itinerary the renter has not answered is not a plan, and a
 * cancelled one is not anything.
 */
export function keptViewings(view: RequestView): KeptViewing[] {
  if (view.state !== 'CONFIRMED') return [];
  const kept = new Set(view.confirmedItemIds);
  const out: KeptViewing[] = [];
  for (const item of Object.values(view.items)) {
    if (!kept.has(item.itemId) || item.state !== 'CONFIRMED') continue;
    const startsAt = (item.slots[0] as { starts_at?: unknown } | undefined)?.starts_at;
    if (typeof startsAt !== 'string' || !Number.isFinite(Date.parse(startsAt))) continue;
    out.push({ itemId: item.itemId, startsAt, date: hcmcDate(new Date(startsAt)) });
  }
  return out.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

/** When the message for `date` goes: 07:00 there, or two hours before its first viewing if that is earlier. */
export function viewingDaySendAt(date: string, firstStartsAt: string): number {
  const seven = Date.parse(`${date}T${String(VIEWING_DAY_SEND_HOUR).padStart(2, '0')}:00:00+07:00`);
  return Math.min(seven, Date.parse(firstStartsAt) - VIEWING_DAY_LEAD_MS);
}

/**
 * The date whose viewing-day message this request owes now, or null.
 *
 * Owed from the send time until the day's last viewing starts - after that
 * there is nobody left to find - and never twice for one date.
 */
export function viewingDayDue(view: RequestView, now: number): string | null {
  const today = hcmcDate(new Date(now));
  if (view.viewingDaysSent.includes(today)) return null;
  const todays = keptViewings(view).filter(v => v.date === today);
  if (todays.length === 0) return null;
  if (now < viewingDaySendAt(today, todays[0].startsAt)) return null;
  if (now >= Date.parse(todays[todays.length - 1].startsAt)) return null;
  return today;
}

export interface DayListing {
  title: string;
  /** `external_properties.location`: often a street and a district, rarely enough. */
  location: string | null;
  realtorId: string | null;
}

export interface DayRequest {
  id: string;
  ref: string;
  view: RequestView;
  listings: Map<string, DayListing>;
}

export interface DayStop {
  requestId: string;
  itemId: string;
  ref: string;
  startsAt: string;
  listingTitle: string;
  /** The agent's meeting point if recorded, else the listing's location. */
  where: string | null;
  meetingPointKnown: boolean;
  agentFirstName: string | null;
  /** Only with the agent's consent, only for a kept viewing on this date. */
  agentPhone: string | null;
}

/**
 * The stops of one renter's viewing day, across all their requests.
 *
 * **The only place a realtor's number enters anything a renter reads.** A
 * number is attached when all of these hold: the request is CONFIRMED, the
 * renter kept this viewing, it is on `date`, and the agent's recorded consent
 * says yes. `phones` holds whatever the caller loaded; this decides.
 */
export function dayStops(requests: DayRequest[], date: string, phones: Map<string, string>): DayStop[] {
  const stops: DayStop[] = [];
  for (const r of requests) {
    for (const kept of keptViewings(r.view)) {
      if (kept.date !== date) continue;
      const item = r.view.items[kept.itemId];
      const listing = r.listings.get(kept.itemId);
      const details = item.details;
      const realtorId = item.realtorId ?? listing?.realtorId ?? null;
      stops.push({
        requestId: r.id,
        itemId: kept.itemId,
        ref: r.ref,
        startsAt: kept.startsAt,
        listingTitle: listing?.title ?? 'Your viewing',
        where: details?.meetingPoint ?? (listing?.location ? oneLine(listing.location) : null),
        meetingPointKnown: !!details,
        agentFirstName: details?.agentFirstName ?? null,
        agentPhone: details?.sharePhone && realtorId ? phones.get(realtorId) ?? null : null,
      });
    }
  }
  return stops.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

/** `+84 90 123 4567` - readable, and still tappable in WhatsApp. */
export function formatAgentPhone(e164: string): string {
  const vn = /^\+84(\d{2})(\d{3})(\d{4})$/.exec(e164);
  return vn ? `+84 ${vn[1]} ${vn[2]} ${vn[3]}` : e164;
}

function agentLine(s: DayStop): string | null {
  const phone = s.agentPhone ? formatAgentPhone(s.agentPhone) : null;
  if (s.agentFirstName && phone) return `${s.agentFirstName}, ${phone}`;
  return s.agentFirstName ?? phone;
}

/** `Sat 3 Oct`. */
function dayName(date: string): string {
  return new Date(`${date}T05:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh', weekday: 'short', day: 'numeric', month: 'short',
  });
}

function refLine(stops: DayStop[]): string {
  const refs = [...new Set(stops.map(s => s.ref))];
  return `${refs.length === 1 ? 'Ref' : 'Refs'} ${refs.join(', ')}`;
}

/** The free-form message, for a renter whose window is open. */
export function renderViewingDay(stops: DayStop[], date: string): string {
  const lines: string[] = [
    stops.length === 1 ? `Your viewing today, ${dayName(date)}:` : `Your viewings today, ${dayName(date)}:`,
  ];
  stops.forEach((s, i) => {
    lines.push('');
    lines.push(`${stops.length === 1 ? '' : `${i + 1}. `}${hcmcTime(s.startsAt)} - ${s.listingTitle}`);
    const indent = stops.length === 1 ? '' : '   ';
    if (s.where) lines.push(`${indent}${s.meetingPointKnown ? 'Meet' : 'Where'}: ${s.where}`);
    const agent = agentLine(s);
    if (agent) lines.push(`${indent}Agent: ${agent}`);
  });
  lines.push('');
  lines.push(stops.some(s => s.agentPhone)
    ? 'Running late or cannot find it? Call the agent, or reply here and we will sort it out.'
    : 'Running late or cannot find it? Reply here and we will reach the agent for you.');
  lines.push(refLine(stops));
  return lines.join('\n');
}

/** Past this the template parameter is cut, and the rest follow a reply. */
export const TEMPLATE_PLACE_MAX = 700;

function inlineStop(s: DayStop): string {
  const parts = [s.listingTitle];
  if (s.where) parts.push(`${s.meetingPointKnown ? 'meet' : 'where'}: ${s.where}`);
  const agent = agentLine(s);
  if (agent) parts.push(`agent: ${agent}`);
  return parts.join(' - ');
}

/**
 * Parameters for `viewing_reminder`, for a renter whose window has closed -
 * the usual case, days after they said yes:
 *
 *   Hi {{1}}, a reminder that your viewing is {{2}} at {{3}}. Reply here if
 *   anything has changed and we will rearrange it.
 *
 * Every viewing that day goes in {{3}}, on one line - Meta refuses a parameter
 * with a line break in it - until it runs long, when the rest are left to the
 * renter's reply.
 */
export function viewingDayTemplateParams(renterName: string | null, stops: DayStop[]): string[] {
  const first = (renterName ?? '').trim().split(/\s+/)[0] || 'there';
  let place = inlineStop(stops[0]);
  let shown = 1;
  for (const s of stops.slice(1)) {
    const next = `${place}; then ${hcmcTime(s.startsAt)} at ${inlineStop(s)}`;
    if (next.length > TEMPLATE_PLACE_MAX) break;
    place = next;
    shown++;
  }
  const rest = stops.length - shown;
  if (rest > 0) place += `; and ${rest} more today - reply here for the full list`;
  return [first, `today at ${hcmcTime(stops[0].startsAt)}`, oneLine(place)];
}

export type ViewingDayResult =
  | { ok: true; messageId: string; deduplicated: boolean; date: string; stops: number; via: 'FREE_FORM' | 'TEMPLATE' }
  | { ok: false; code: 'unknown_request' | 'not_due' | 'too_many_consecutive' | 'template_unavailable' | 'send_failed';
      message: string };

/**
 * Send one renter today's viewing-day message, if the request asked about owes
 * one. Covers every request of theirs with a viewing today, so two requests'
 * jobs make one message: the idempotency key is the renter and the date, and
 * the second job finds the first one's row.
 */
export async function sendViewingDay(
  db: Supa,
  adapter: WhatsAppAdapter,
  opts: { requestId: string; now: Date; attempt?: number; actor?: string },
): Promise<ViewingDayResult> {
  const { data: request } = await db
    .from('viewing_requests').select('id, ref, renter_id').eq('id', opts.requestId).maybeSingle();
  if (!request?.renter_id) return { ok: false, code: 'unknown_request', message: `Unknown request ${opts.requestId}` };

  const now = opts.now.getTime();
  const own = reduceRequest(request.id, await loadEvents(db, request.id));
  const date = viewingDayDue(own, now);
  if (!date) return { ok: false, code: 'not_due', message: 'Nothing today owes a viewing-day message.' };

  // Every request of theirs, so a second request's viewings that day ride in
  // the same message rather than a second one.
  const { data: siblings } = await db
    .from('viewing_requests').select('id, ref').eq('renter_id', request.renter_id)
    .order('created_at', { ascending: false }).limit(20);
  const requests: DayRequest[] = [];
  for (const r of (siblings ?? []) as { id: string; ref: string }[]) {
    const view = r.id === request.id ? own : reduceRequest(r.id, await loadEvents(db, r.id));
    if (!keptViewings(view).some(v => v.date === date)) continue;
    requests.push({ id: r.id, ref: r.ref, view, listings: await loadListings(db, r.id) });
  }

  // Numbers only for the agents who agreed, so nothing else is ever in hand.
  const consented = new Set<string>();
  for (const r of requests) {
    for (const kept of keptViewings(r.view)) {
      const item = r.view.items[kept.itemId];
      const realtorId = item.realtorId ?? r.listings.get(kept.itemId)?.realtorId;
      if (kept.date === date && item.details?.sharePhone && realtorId) consented.add(realtorId);
    }
  }
  const phones = new Map<string, string>();
  if (consented.size > 0) {
    const { data: realtors } = await db.from('realtors').select('id, phone_e164').in('id', [...consented]);
    for (const r of (realtors ?? []) as { id: string; phone_e164: string | null }[]) {
      if (r.phone_e164) phones.set(String(r.id), r.phone_e164);
    }
  }

  const stops = dayStops(requests, date, phones);
  if (stops.length === 0) return { ok: false, code: 'not_due', message: 'No viewings today.' };

  const store = new SupabaseMessageStore(db);
  const renter = await store.getRenter(request.renter_id);
  if (!renter) return { ok: false, code: 'unknown_request', message: `Unknown renter ${request.renter_id}` };
  // Filed on the first viewing's request, which both requests' jobs agree on.
  const threadRequestId = stops[0].requestId;
  const purpose = `VIEWING_DAY:${date}`;
  const open = isWindowOpen(renter, opts.now);

  let sent;
  try {
    if (open) {
      sent = await sendFreeForm(store, adapter, {
        renterId: renter.id, requestId: threadRequestId, purpose, body: renderViewingDay(stops, date),
        attempt: opts.attempt ?? 1, now: opts.now,
      });
    } else {
      const { data: named } = await db.from('renters').select('display_name').eq('id', renter.id).maybeSingle();
      sent = await sendTemplate(store, adapter, {
        renterId: renter.id, requestId: threadRequestId, purpose,
        templateName: TEMPLATES.VIEWING_REMINDER.name,
        params: viewingDayTemplateParams(named?.display_name ?? null, stops),
        attempt: opts.attempt ?? 1,
      });
    }
  } catch (e) {
    if (e instanceof ConsecutiveMessageError) {
      return { ok: false, code: 'too_many_consecutive', message: (e as Error).message };
    }
    if (e instanceof UnapprovedTemplateError) {
      return { ok: false, code: 'template_unavailable', message: (e as Error).message };
    }
    return { ok: false, code: 'send_failed', message: (e as Error).message };
  }
  if (sent.message.status === 'FAILED') return { ok: false, code: 'send_failed', message: 'WhatsApp refused the message.' };

  const result = {
    ok: true as const, messageId: sent.message.id, deduplicated: sent.deduplicated, date, stops: stops.length,
    via: open ? 'FREE_FORM' as const : 'TEMPLATE' as const,
  };
  // The job that found the message already sent finds its events written too.
  if (sent.deduplicated) return result;

  const covered = [...new Set(stops.map(s => s.requestId))];
  const { error } = await db.from('events').insert(covered.map(requestId => ({
    request_id: requestId,
    type: 'VIEWING_DAY_SENT',
    payload: {
      date,
      message_id: sent.message.id,
      item_ids: stops.filter(s => s.requestId === requestId).map(s => s.itemId),
      shared_phone_item_ids: stops.filter(s => s.requestId === requestId && s.agentPhone).map(s => s.itemId),
    },
    actor: opts.actor ?? 'SYSTEM',
  })));
  if (error) console.error('[viewing-day] event insert failed after a successful send:', error.message ?? error);
  return result;
}

async function loadEvents(db: Supa, requestId: string): Promise<DomainEvent[]> {
  const { data } = await db
    .from('events')
    .select('id, request_id, item_id, type, payload, actor, occurred_at')
    .eq('request_id', requestId)
    .order('occurred_at', { ascending: true });
  return (data ?? []) as DomainEvent[];
}

async function loadListings(db: Supa, requestId: string): Promise<Map<string, DayListing>> {
  const { data: items } = await db
    .from('request_items').select('id, listing_id, realtor_id').eq('request_id', requestId);
  const rows = (items ?? []) as { id: string; listing_id: string; realtor_id: string | null }[];
  const { data: listings } = rows.length
    ? await db.from('external_properties').select('id, title, location').in('id', rows.map(r => r.listing_id))
    : { data: [] };
  const byId = new Map(((listings ?? []) as { id: string; title: string | null; location: string | null }[])
    .map(l => [String(l.id), l]));
  return new Map(rows.map(r => {
    const l = byId.get(String(r.listing_id));
    return [String(r.id), { title: l?.title ?? 'Your viewing', location: l?.location ?? null, realtorId: r.realtor_id }];
  }));
}
