// An availability request - a building, or Priority search - as its renter
// sees it in the hub's Viewings tab, beside their viewing requests
// (2026-10-09). Until then the form's last screen was the only place it
// showed, and a renter who closed it could not find the request again, see
// where it stood, or open the places we sent them anywhere but WhatsApp.
//
// Reduced on the server and handed over as words, like renter-view.ts:
// `inquiry_events` and the thread carry agents, operators' notes and what
// was said, none of which the tab needs. So this carries no agent field of
// any kind (SPEC §6) - not who was asked, not how many - only where the
// request stands, what was asked for, and the places offered.
//
// Read-only. Changing a request is a conversation on its WhatsApp thread, and
// a viewing of a place found is requested the one way there is (invariant 8).

import {
  inquiryDeadline, reduceInquiry, type InquiryCloseReason, type InquiryEvent, type InquiryView,
} from '../viewing-domain.ts';
import { formatVnd, hcmcLong } from './format.ts';
import { buildInquiryLink, buildSearchLink } from './inquiry.ts';
import { areaLabel, type PlaceKind } from './place.ts';
import { codeUsable } from './watch.ts';

// deno-lint-ignore no-explicit-any
type Supa = any;

/** Where the request stands, in the renter's terms. */
export type InquiryStage =
  | 'SEND_CODE'      // the form is in; the WhatsApp message that starts it is not
  | 'CHECKING'       // the message arrived - a person is asking agents, or searching
  | 'FOUND'          // places sent on WhatsApp
  | 'VIEWING'        // closed: they asked to view a place we found
  | 'NOTHING_FOUND'
  | 'CLOSED'         // any other close
  | 'NOT_SENT';      // the code lapsed before the message was sent

export interface RenterFoundPlace {
  listingId: string;
  title: string;
  imageUrl: string | null;
  priceVnd: number | null;
  bedrooms: number | null;
  /** Still listed. A captured unit lapses when its agent's word goes stale (S7.1b). */
  listed: boolean;
  /** Its page, carrying the request, so a viewing asked from it closes this one (S7.1c). */
  path: string;
}

export interface RenterInquiry {
  id: string;
  /** HW-XXXX, the code the WhatsApp message carries. */
  code: string;
  kind: PlaceKind;
  /** "Celadon City", or "District 2 and Binh Thanh". */
  place: string;
  createdAt: string;
  stage: InquiryStage;
  stageLabel: string;
  /** What was asked for, one line: "2 bedrooms · up to 25.000.000 ₫ a month · moving in 15 Nov". */
  brief: string;
  /** Until when new listings there are alerted, while the watch runs. */
  alertsUntil: string | null;
  /** The places we sent, in the order they went. */
  found: RenterFoundPlace[];
}

export interface RenterInquiryRow {
  id: string;
  code: string;
  kind: PlaceKind;
  place: string;
  createdAt: string;
  moveIn: string | null;
  bedrooms: number | null;
  budgetMaxVnd: number | null;
  watch: { status: string; expiresAt: string } | null;
}

export interface FoundListingRow {
  id: string;
  title: string | null;
  imageUrl: string | null;
  priceVnd: number | null;
  bedrooms: number | null;
  isActive: boolean;
}

function stageOf(view: InquiryView, row: RenterInquiryRow, now: number): InquiryStage {
  switch (view.state) {
    case 'AWAITING_CODE':
      // No watch means no code to send, so nothing the renter can still do.
      return row.watch && codeUsable(row.createdAt, row.watch.expiresAt, new Date(now)) === 'OK' ? 'SEND_CODE' : 'NOT_SENT';
    case 'NEW':
    case 'SOURCING':
      return 'CHECKING';
    case 'OFFERED':
      return 'FOUND';
    case 'CLOSED':
      return view.closedReason === 'VIEWING_REQUESTED' ? 'VIEWING'
        : view.closedReason === 'NOTHING_FOUND' ? 'NOTHING_FOUND'
        : 'CLOSED';
  }
}

const CLOSED_LABEL: Partial<Record<InquiryCloseReason, string>> = {
  RENTER_WENT_QUIET: 'Closed - we did not hear back from you',
  RENTED_ELSEWHERE: 'Closed - you found a place',
  LEASE_SIGNED: 'Closed - you found a place',
  DUPLICATE: 'Closed - the same as another of your requests',
};

function stageLabel(stage: InquiryStage, kind: PlaceKind, view: InquiryView, found: number, now: number): string {
  const area = kind === 'AREA';
  switch (stage) {
    case 'SEND_CODE':
      return 'Waiting for your WhatsApp message - send it and we start';
    case 'CHECKING': {
      const by = inquiryDeadline(view);
      if (by && Date.parse(by) > now) {
        return area
          ? `Searching - the first places reach you on WhatsApp by ${hcmcLong(by)}`
          : `Asking the agents here - we reply on WhatsApp by ${hcmcLong(by)}`;
      }
      return area
        ? 'Still searching - we message you on WhatsApp'
        : 'Still asking the agents - we message you on WhatsApp';
    }
    case 'FOUND':
      return found > 0
        ? `We found ${found === 1 ? '1 place' : `${found} places`} - open one to request a viewing`
        : 'We sent you places on WhatsApp';
    case 'VIEWING':
      return 'You asked to view a place we found';
    case 'NOTHING_FOUND':
      return area ? 'We found nothing that fits for now' : 'Nothing there that fits is free for now';
    case 'CLOSED':
      return (view.closedReason && CLOSED_LABEL[view.closedReason]) ?? 'Closed';
    case 'NOT_SENT':
      return 'Never sent on WhatsApp - the code has expired';
  }
}

/** "2 bedrooms", "2 or 3 bedrooms", "4+ bedrooms". */
function bedroomsText(beds: number[]): string | null {
  if (beds.length === 0) return null;
  const names = beds.map(b => (b >= 4 ? '4+' : String(b)));
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
  return `${list} ${beds.length === 1 && beds[0] === 1 ? 'bedroom' : 'bedrooms'}`;
}

/** `2026-11-15` -> "15 Nov". A date, not an instant: no time zone to shift it. */
function dayMonth(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/**
 * The brief in force: the form's, unless the renter widened it on the thread
 * (BRIEF_CHANGED) - what may be offered is what they are told they asked for.
 */
function briefText(view: InquiryView, row: RenterInquiryRow): string {
  const beds = view.brief?.bedrooms ?? (row.bedrooms ? [row.bedrooms] : []);
  const budget = view.brief ? view.brief.budgetMaxVnd : row.budgetMaxVnd;
  return [
    bedroomsText(beds),
    budget ? `up to ${formatVnd(budget)} a month` : null,
    row.moveIn ? `moving in ${dayMonth(row.moveIn)}` : null,
  ].filter(Boolean).join(' · ');
}

/** Pure: one request, its log, and the listings it offered. */
export function renterInquiryView(opts: {
  row: RenterInquiryRow;
  events: InquiryEvent[];
  listings: FoundListingRow[];
  now: number;
}): RenterInquiry {
  const { row, now } = opts;
  const view = reduceInquiry(row.id, opts.events);
  const stage = stageOf(view, row, now);
  const byId = new Map(opts.listings.map(l => [l.id, l]));
  const found = view.offeredListingIds.map((id): RenterFoundPlace => {
    const l = byId.get(id);
    return {
      listingId: id,
      title: l?.title || 'A place',
      imageUrl: l?.imageUrl ?? null,
      priceVnd: l?.priceVnd ?? null,
      bedrooms: l?.bedrooms ?? null,
      listed: !!l?.isActive,
      path: `/property/${id}?inq=${row.id}`,
    };
  });
  const watchRuns = row.watch?.status === 'ACTIVE' && Date.parse(row.watch.expiresAt) > now;
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    place: row.place,
    createdAt: row.createdAt,
    stage,
    stageLabel: stageLabel(stage, row.kind, view, found.length, now),
    brief: briefText(view, row),
    alertsUntil: watchRuns ? row.watch!.expiresAt : null,
    found,
  };
}

/**
 * The WhatsApp button. Before the code arrives it is the form's own link, so
 * the message still starts the request; after, a plain chat - a code sent
 * twice is a handshake already made, and is filed on no thread.
 */
export function inquiryWaLink(r: Pick<RenterInquiry, 'stage' | 'kind' | 'code' | 'place'>, businessPhoneE164: string): string {
  if (r.stage === 'SEND_CODE') {
    return r.kind === 'AREA'
      ? buildSearchLink(businessPhoneE164, r.code, r.place)
      : buildInquiryLink(businessPhoneE164, r.code, r.place);
  }
  return `https://wa.me/${businessPhoneE164.replace(/[^0-9]/g, '')}`;
}

/**
 * The account's WhatsApp requests from the last `sinceDays`, newest first:
 * made signed in, or confirmed from a number linked to the account - the
 * identity rule the viewing requests beside them use (`renters.user_id`).
 * Email requests from before WhatsApp are answered by email and left out.
 */
export async function listRenterInquiries(
  db: Supa,
  userId: string,
  opts: { now: number; businessPhone: string; sinceDays: number; limit?: number },
): Promise<(RenterInquiry & { waLink: string })[]> {
  const since = new Date(opts.now - opts.sinceDays * 86_400_000).toISOString();
  const limit = opts.limit ?? 20;
  const COLS = 'id, user_id, renter_id, complex_id, area_district_codes, area_label, watch_id, channel, created_at, '
    + 'target_move_in_date, bedrooms_needed, budget_max_vnd';

  const { data: renters } = await db.from('renters').select('id').eq('user_id', userId);
  const renterIds = ((renters ?? []) as { id: string }[]).map(r => r.id);
  const [{ data: mine }, { data: viaNumber }] = await Promise.all([
    db.from('complex_inquiries').select(COLS).eq('user_id', userId).eq('channel', 'WHATSAPP')
      .gte('created_at', since).order('created_at', { ascending: false }).limit(limit),
    renterIds.length
      ? db.from('complex_inquiries').select(COLS).in('renter_id', renterIds).eq('channel', 'WHATSAPP')
        .gte('created_at', since).order('created_at', { ascending: false }).limit(limit)
      : Promise.resolve({ data: [] }),
  ]);
  type Row = Record<string, unknown> & { id: string; created_at: string };
  const byId = new Map<string, Row>();
  for (const r of [...(mine ?? []), ...(viaNumber ?? [])] as Row[]) byId.set(r.id, r);
  const rows = [...byId.values()]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
    .slice(0, limit);
  if (rows.length === 0) return [];

  const ids = rows.map(r => r.id);
  const watchIds = rows.map(r => r.watch_id).filter((x): x is string => typeof x === 'string');
  const complexIds = [...new Set(rows.map(r => r.complex_id).filter((x): x is string => typeof x === 'string'))];
  const [{ data: events }, { data: watches }, { data: complexes }] = await Promise.all([
    db.from('inquiry_events').select('id, inquiry_id, type, payload, actor, occurred_at').in('inquiry_id', ids),
    watchIds.length
      ? db.from('complex_watches').select('id, code, status, expires_at').in('id', watchIds)
      : Promise.resolve({ data: [] }),
    complexIds.length
      ? db.from('complexes').select('id, name').in('id', complexIds)
      : Promise.resolve({ data: [] }),
  ]);
  const eventsOf = (id: string) => ((events ?? []) as InquiryEvent[]).filter(e => e.inquiry_id === id);
  const watchOf = new Map(((watches ?? []) as { id: string; code: string; status: string; expires_at: string }[])
    .map(w => [w.id, w]));
  const complexName = new Map(((complexes ?? []) as { id: string; name: string }[]).map(c => [c.id, c.name]));

  // Every listing any of them offered, read once.
  const offered = [...new Set(ids.flatMap(id => reduceInquiry(id, eventsOf(id)).offeredListingIds))];
  const { data: listings } = offered.length
    ? await db.from('external_properties').select('id, title, images, price_vnd, bedrooms, is_active').in('id', offered)
    : { data: [] };
  const listingRows: FoundListingRow[] = ((listings ?? []) as Record<string, unknown>[]).map(l => ({
    id: String(l.id),
    title: (l.title as string | null) ?? null,
    imageUrl: (l.images as unknown[] | null)?.find((u): u is string => typeof u === 'string' && u.startsWith('http')) ?? null,
    priceVnd: typeof l.price_vnd === 'number' ? l.price_vnd : l.price_vnd != null ? Number(l.price_vnd) : null,
    bedrooms: typeof l.bedrooms === 'number' ? l.bedrooms : null,
    isActive: l.is_active === true,
  }));

  return rows.map(r => {
    const watch = typeof r.watch_id === 'string' ? watchOf.get(r.watch_id) ?? null : null;
    const codes = Array.isArray(r.area_district_codes) ? r.area_district_codes as string[] : [];
    const kind: PlaceKind = r.complex_id ? 'BUILDING' : 'AREA';
    const place = kind === 'BUILDING'
      ? complexName.get(String(r.complex_id)) ?? 'The building'
      : (r.area_label as string | null) || (codes.length ? areaLabel(codes) : 'Your search');
    const view = renterInquiryView({
      row: {
        id: r.id,
        code: watch?.code ?? '',
        kind,
        place,
        createdAt: r.created_at,
        moveIn: (r.target_move_in_date as string | null) ?? null,
        bedrooms: typeof r.bedrooms_needed === 'number' ? r.bedrooms_needed : null,
        budgetMaxVnd: r.budget_max_vnd != null ? Number(r.budget_max_vnd) : null,
        watch: watch ? { status: watch.status, expiresAt: watch.expires_at } : null,
      },
      events: eventsOf(r.id),
      listings: listingRows,
      now: opts.now,
    });
    return { ...view, waLink: inquiryWaLink(view, opts.businessPhone) };
  });
}
