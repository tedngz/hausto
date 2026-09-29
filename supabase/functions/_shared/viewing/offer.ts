// Turning an agent's offer into something a renter can ask to see, and the
// one message that puts it in front of them (PLAN-v3 S7.1b, SPEC §11).
//
// A captured unit is an ordinary `external_properties` row with
// `source = 'concierge'`: that is what lets Request viewing, the viewing flow
// and the alerts treat it like any listing. It is written the way the crawler
// writes one - raw `rooms`, `size`, `location`, `price` - and
// `sync_canonical_listing_fields()` derives `bedrooms`, `area_sqm`,
// `district_code`, `price_vnd` and `price_confidence`, so there is one parser.
//
// Pure. The I/O is INQUIRY_CAPTURE_UNIT / INQUIRY_OFFER_UNITS in
// inquiry-actions.ts.

import { formatVnd } from './format.ts';
import { MAX_BEDROOMS, MAX_BUDGET_VND, MIN_BUDGET_VND, SITE_URL } from './watch.ts';

export const CONCIERGE_SOURCE = 'concierge';

/** An agent's "it's free" goes stale fast. After this, a unit comes down unless reconfirmed. */
export const UNIT_FRESH_DAYS = 14;

/** Units in one offer - one message, readable on a phone. */
export const MAX_OFFER_UNITS = 5;
export const MAX_PHOTOS = 10;

export const FURNISHING = ['FULL', 'PARTIAL', 'NONE'] as const;
export type Furnishing = typeof FURNISHING[number];

export interface UnitInput {
  realtorId: string;
  bedrooms: number;
  areaSqm: number;
  priceVnd: number;
  floor: string | null;
  tower: string | null;
  furnishing: Furnishing | null;
  petsOk: boolean | null;
  availableFrom: string | null;
  photos: string[];
  /** For the operator and the log; never shown to the renter. */
  note: string | null;
}

export type UnitValidation = { ok: true; value: UnitInput } | { ok: false; error: string };

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

// deno-lint-ignore no-explicit-any
export function validateUnit(raw: any, photoPath: string): UnitValidation {
  const realtorId = str(raw?.realtorId);
  if (!/^[0-9a-f-]{36}$/i.test(realtorId)) return { ok: false, error: 'Pick the agent who offered it.' };

  const bedrooms = Number(raw?.bedrooms);
  if (!(Number.isInteger(bedrooms) && bedrooms >= 1 && bedrooms <= MAX_BEDROOMS)) {
    return { ok: false, error: 'Bedrooms is 1 to 4 (4 for four or more).' };
  }
  const areaSqm = Number(raw?.areaSqm);
  if (!(Number.isInteger(areaSqm) && areaSqm >= 15 && areaSqm <= 1000)) {
    return { ok: false, error: 'Floor area is a whole number of m², 15 to 1000.' };
  }
  const priceVnd = Number(raw?.priceVnd);
  if (!(Number.isInteger(priceVnd) && priceVnd >= MIN_BUDGET_VND && priceVnd <= MAX_BUDGET_VND)) {
    return { ok: false, error: `Monthly rent in dong, ${formatVnd(MIN_BUDGET_VND)} to ${formatVnd(MAX_BUDGET_VND)}.` };
  }

  const furnishingRaw = str(raw?.furnishing).toUpperCase();
  const furnishing = furnishingRaw ? furnishingRaw as Furnishing : null;
  if (furnishing && !FURNISHING.includes(furnishing)) return { ok: false, error: 'Furnishing is FULL, PARTIAL or NONE.' };

  const availableFrom = str(raw?.availableFrom) || null;
  if (availableFrom && (!/^\d{4}-\d{2}-\d{2}$/.test(availableFrom) || Number.isNaN(Date.parse(availableFrom)))) {
    return { ok: false, error: 'Available-from is a date.' };
  }

  const photos: string[] = Array.isArray(raw?.photos) ? raw.photos.map(str).filter(Boolean) : [];
  if (photos.length > MAX_PHOTOS) return { ok: false, error: `At most ${MAX_PHOTOS} photos.` };
  // Only what the console uploaded: a unit's photos are shown to renters, so
  // they come from our bucket, not from wherever a pasted link points.
  if (photos.some(p => !p.startsWith('https://') || !p.includes(photoPath))) {
    return { ok: false, error: 'Upload photos here rather than linking them.' };
  }

  return {
    ok: true,
    value: {
      realtorId, bedrooms, areaSqm, priceVnd, photos,
      floor: str(raw?.floor).slice(0, 20) || null,
      tower: str(raw?.tower).slice(0, 40) || null,
      furnishing,
      petsOk: typeof raw?.petsOk === 'boolean' ? raw.petsOk : null,
      availableFrom,
      note: str(raw?.note).slice(0, 500) || null,
    },
  };
}

const bedsLabel = (n: number) => (n >= MAX_BEDROOMS ? `${MAX_BEDROOMS}+BR` : `${n}BR`);
const FURNISHED_LABEL: Record<Furnishing, string> = { FULL: 'furnished', PARTIAL: 'partly furnished', NONE: 'unfurnished' };

function dayMonth(isoOrDate: string): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(isoOrDate) ? `${isoOrDate}T12:00:00+07:00` : isoOrDate;
  return new Date(d).toLocaleDateString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: 'numeric', month: 'short' });
}

/**
 * The `external_properties` row for a captured unit, before the trigger fills
 * the canonical columns. `rooms`, `size`, `location` and `price` are in the
 * shapes the parsers read (`parse_bedrooms('2 Bedrooms')`, `'80 m²'`,
 * `vn_district_code(city, 'Empire City, Thu Duc')`).
 */
export function unitRow(opts: {
  id: string;
  inquiryId: string;
  complex: { name: string; district: string | null; city: string };
  unit: UnitInput;
  now: Date;
}): Record<string, unknown> {
  const u = opts.unit;
  const title = [
    `${bedsLabel(u.bedrooms)} at ${opts.complex.name}`,
    u.tower ? `${u.tower}` : null,
    u.floor ? `floor ${u.floor}` : null,
    u.furnishing ? FURNISHED_LABEL[u.furnishing] : null,
  ].filter(Boolean).join(', ');
  const now = opts.now.toISOString();
  return {
    id: opts.id,
    source: CONCIERGE_SOURCE,
    // Unique per unit, and says where it came from.
    external_id: `concierge:${opts.inquiryId}:${opts.id}`,
    source_url: `${SITE_URL}/property/${opts.id}`,
    title,
    location: [opts.complex.name, opts.complex.district].filter(Boolean).join(', '),
    city: opts.complex.city,
    rooms: u.bedrooms >= MAX_BEDROOMS ? `${MAX_BEDROOMS}+ Bedrooms` : `${u.bedrooms} Bedroom${u.bedrooms === 1 ? '' : 's'}`,
    size: `${u.areaSqm} m²`,
    price: u.priceVnd,
    price_display: `${formatVnd(u.priceVnd)}/month`,
    description: [
      `Offered by an agent for a Hausto availability request.`,
      u.availableFrom ? `Available from ${dayMonth(u.availableFrom)}.` : null,
      u.petsOk === true ? 'Pets allowed.' : u.petsOk === false ? 'No pets.' : null,
      `Confirmed available on ${dayMonth(now)}.`,
    ].filter(Boolean).join(' '),
    images: u.photos,
    // The agent is reached through realtor_id, as the viewing flow does. No
    // contact_name / contact_phone: this row is served to renters by
    // get-public-property, and an agent's number never reaches one (invariant 4).
    realtor_id: u.realtorId,
    is_active: true,
    raw_only: false,
    crawled_at: now,
    last_verified_at: now,
    last_verification_status: 'alive',
    last_verification_reason: 'agent_confirmed',
  };
}

export interface OfferUnit {
  id: string;
  title: string;
  priceVnd: number;
  bedrooms: number;
  areaSqm: number | null;
  /** A captured unit an agent confirmed, or an advertised one nobody has yet. */
  confirmedAt: string | null;
}

export function offerLink(listingId: string, inquiryId: string): string {
  return `${SITE_URL}/property/${listingId}?inq=${inquiryId}`;
}

/**
 * The one message (SPEC §11): the confirmation plus this is the two-in-a-row
 * limit, so it carries everything and ends by inviting a reply. No booking
 * vocabulary (invariant 6): nothing is arranged until they ask.
 */
export function renderOffer(opts: {
  firstName: string | null;
  complexName: string;
  inquiryId: string;
  units: OfferUnit[];
  /** The operator's own line, already checked by checkOperatorReply. */
  message?: string | null;
  now: Date;
}): string {
  const hello = `Hi ${opts.firstName?.trim() || 'there'}, here is what we found at ${opts.complexName}:`;
  const lines = opts.units.map((u, i) => {
    const facts = [
      // Captured titles already lead with it (unitRow); an advertised one may not.
      u.title.startsWith(bedsLabel(u.bedrooms)) ? null : bedsLabel(u.bedrooms),
      `${formatVnd(u.priceVnd)} a month`,
      u.areaSqm ? `${u.areaSqm} m²` : null,
    ].filter(Boolean).join(' · ');
    const standing = u.confirmedAt
      ? `The agent confirmed it is free on ${dayMonth(u.confirmedAt)}.`
      : 'Advertised - we confirm with the agent when you ask to see it.';
    return `${i + 1}. ${u.title}\n${facts}\n${standing}\n${offerLink(u.id, opts.inquiryId)}`;
  });
  return [
    hello,
    ...(opts.message?.trim() ? [opts.message.trim()] : []),
    ...lines,
    'To see any of them, open it and tap Request viewing - your first viewing is free. Or reply here with a question.',
  ].join('\n\n');
}

/** Whether a captured unit is past its freshness, from when it was last confirmed. */
export function unitStale(lastVerifiedAt: string | null, now: Date): boolean {
  if (!lastVerifiedAt) return true;
  return now.getTime() - Date.parse(lastVerifiedAt) > UNIT_FRESH_DAYS * 86_400_000;
}


/** Where the console uploads a request's photos, inside the public listing-images bucket. */
export function unitPhotoPath(inquiryId: string): string {
  return `/storage/v1/object/public/external-property-images/concierge/${inquiryId}/`;
}
