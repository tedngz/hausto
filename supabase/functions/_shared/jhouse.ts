// jhouse.vn - an HCMC agency's own site (Next.js), run off its CRM.
//
// The pages render from a public JSON API on crm.jhouse.vn, the same one the
// site's own search calls, and it hands back every fact a listing needs as a
// typed field: rent in dong, size, bedrooms, the building and its district,
// the gallery, and an availability status. It can be asked for units still on
// offer only, newest first, and narrowed to a district:
//
//   /api/public/units?statuses=available,upcoming&sort=newest&districts=Quận 1&per_page=48
//
//   available   free now
//   upcoming    free from `available_from` ("2026-11-03")
//   rented      gone - 1,660 of 2,318 units on 2026-10-15, so the filter matters
//
// 48 a page is the API's ceiling (it answers 422 above it). A unit's own
// record - description, amenities, fees - is /api/public/units/<slug>, which
// answers 404 once the unit is removed. The public page does not: /property/
// <anything> renders a 200, so verification reads the API, never the page.
//
// A listing is /property/<slug_en>. The agency's code (H03287) never appears
// in a URL, and the API cannot be asked for a unit by code, so the stored
// reference is the slug ("jh-rome-apartment-thao-dien-1-bedroom-a603").

import {
  type Availability, type AgencyListing, type AgencyVerification, type BuildResult, type FeedCandidate,
  decodeEntities, districtKey, fetchJson, fetchPage, firstTelLink, htmlToText, listingAvailability, prioritise,
  rentToVnd, roomsLabel,
} from './agency-feeds.ts';
import {
  type Fee, type LeaseTerms,
  depositFromField, feeAmountFromField, feeKindOf, hcmcDay, mergeTerms, petsFromField, readTermsFromText,
} from './lease-terms.ts';
import { normalizeLocationForEnglishDisplay } from './location-language.ts';

export const JHOUSE_ORIGIN = 'https://jhouse.vn';
const API = 'https://crm.jhouse.vn/api/public';
const PER_PAGE = 48;

// The API's `districts` filter takes the site's own names, comma-separated
// (checked against each rotation district on 2026-10-15). Thủ Đức is where the
// site files almost nothing; its District 2 stock (Thao Dien, An Phu, Thu
// Thiem) sits under "Quận 2", which is what the rotation means by Thủ Đức. An
// unmapped district crawls the whole feed instead, which is safe: a listing's
// district is read from its own record, never from this.
const DISTRICT_FILTERS: Record<string, string[]> = {
  'quan 1': ['Quận 1'],
  'quan 3': ['Quận 3'],
  'quan 4': ['Quận 4'],
  'quan 7': ['Quận 7'],
  'quan 10': ['Quận 10'],
  'binh thanh': ['Bình Thạnh'],
  'phu nhuan': ['Phú Nhuận'],
  'tan binh': ['Tân Bình'],
  'go vap': ['Gò Vấp'],
  'thu duc': ['Quận 2', 'Thủ Đức'],
};

// deno-lint-ignore no-explicit-any
export type JhouseUnit = Record<string, any>;

/** "jh-rome-apartment-thao-dien-1-bedroom-a603". */
export function extractJhouseId(url: string): string | null {
  const slug = jhouseSlug(url);
  return slug ? `jh-${slug}` : null;
}

export function jhouseSlug(url: string): string | null {
  const m = url.match(/^https?:\/\/(?:www\.)?jhouse\.vn\/property\/([a-z0-9][a-z0-9-]*)\/?(?:[?#].*)?$/i);
  return m ? m[1].toLowerCase() : null;
}

export function isJhouseListingUrl(url: string): boolean {
  return jhouseSlug(url) !== null;
}

export function jhouseListingUrl(unit: JhouseUnit): string | null {
  const slug = typeof unit?.slug_en === 'string' && unit.slug_en ? unit.slug_en : unit?.slug;
  return typeof slug === 'string' && /^[a-z0-9][a-z0-9-]*$/i.test(slug) ? `${JHOUSE_ORIGIN}/property/${slug.toLowerCase()}` : null;
}

/** Units still on offer, newest first, narrowed to the run's district where the site has one. */
export function jhouseFeedUrl(location?: string, page = 1): string {
  const params = new URLSearchParams({
    statuses: 'available,upcoming',
    sort: 'newest',
    per_page: String(PER_PAGE),
    page: String(page),
  });
  const districts = DISTRICT_FILTERS[districtKey(location)];
  if (districts) params.set('districts', districts.join(','));
  return `${API}/units?${params}`;
}

/** YYYY-MM-DD in Ho Chi Minh City, for comparing with `available_from`. */
function todayInHcmc(now: Date): string {
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * The site's status as ours. An "available" unit dated later than today is
 * not free yet, whatever its status says (one on 2026-10-15).
 */
export function jhouseAvailability(unit: JhouseUnit, now = new Date()): Availability {
  const status = String(unit?.status ?? '').toLowerCase();
  if (status === 'rented') return 'RENTED';
  const from = typeof unit?.available_from === 'string' ? unit.available_from.slice(0, 10) : '';
  const later = /^\d{4}-\d{2}-\d{2}$/.test(from) && from > todayInHcmc(now);
  if (status === 'available') return later ? 'AVAILABLE_SOON' : 'AVAILABLE_NOW';
  if (status === 'upcoming') return 'AVAILABLE_SOON';
  return 'UNCONFIRMED';
}

// The unit types are apartment and villa today. Anything a renter cannot live
// in is refused, by name, so a new home type the CRM adds is not.
const NOT_A_HOME = /office|commercial|retail|shop|warehouse|land|business/i;

function isHome(unit: JhouseUnit): boolean {
  return !NOT_A_HOME.test(`${unit?.type ?? ''} ${unit?.building?.type ?? ''}`);
}

function rentOf(unit: JhouseUnit): { price: number; priceDisplay: string } | null {
  const vnd = Number(unit?.price_vnd);
  if (Number.isFinite(vnd) && vnd > 0) return rentToVnd(vnd, 'VND');
  const amount = Number(unit?.price);
  return Number.isFinite(amount) && amount > 0 ? rentToVnd(amount, String(unit?.currency ?? 'VND')) : null;
}

/**
 * Feed units as crawl candidates, in crawl order: free now before free soon,
 * newest first within each. The feed carries no publication date, but it is
 * asked for `sort=newest` and agency codes rise with age (H03290 was the
 * newest on 2026-10-15), so its own order stands. Units that would be refused
 * once built are dropped here, or they would stay "new" and take a slot on
 * every run.
 */
export function candidatesFromJhouseFeed(units: JhouseUnit[], now = new Date()): FeedCandidate[] {
  return prioritise(
    (Array.isArray(units) ? units : [])
      .filter(isHome)
      .flatMap((u) => {
        const url = jhouseListingUrl(u);
        if (!url) return [];
        const rent = rentOf(u);
        return [{
          url,
          title: typeof u.title_en === 'string' && u.title_en ? decodeEntities(u.title_en) : undefined,
          price: rent?.priceDisplay,
          availability: jhouseAvailability(u, now),
          priceVnd: rent?.price,
        } satisfies FeedCandidate];
      }),
  );
}

export async function discoverJhouse(location?: string, pages = 3): Promise<FeedCandidate[]> {
  const units: JhouseUnit[] = [];
  for (let page = 1; page <= Math.max(1, pages); page++) {
    const { status, data } = await fetchJson<{ data?: JhouseUnit[]; meta?: { last_page?: number } }>(jhouseFeedUrl(location, page));
    if (!Array.isArray(data?.data)) {
      if (page === 1) throw new Error(`jhouse feed returned HTTP ${status}`);
      break;
    }
    units.push(...data.data);
    if (data.data.length === 0 || page >= Number(data.meta?.last_page ?? page)) break;
  }
  const ordered = candidatesFromJhouseFeed(units);
  const now = ordered.filter((c) => c.availability === 'AVAILABLE_NOW').length;
  console.log(`[jhouse] feed: ${units.length} unit(s), ${now} available now${DISTRICT_FILTERS[districtKey(location)] ? ` in ${location}` : ''}`);
  return ordered;
}

/** One unit's full record, by its listing URL. Null when the API no longer has it. */
export async function fetchJhouseUnit(url: string): Promise<{ status: number; unit: JhouseUnit | null }> {
  const slug = jhouseSlug(url);
  if (!slug) return { status: 0, unit: null };
  const { status, data } = await fetchJson<{ data?: JhouseUnit }>(`${API}/units/${encodeURIComponent(slug)}`);
  return { status, unit: data?.data && typeof data.data === 'object' ? data.data : null };
}

// ─── Building a listing from a record ────────────────────────────────────

// For the units with no district at all (two on 2026-10-15, both the ACE
// building in Phu Nhuan), the district their own title or slug names, else an
// area expats name instead of one. Neighbourhoods are filed under the pre-2021
// districts, as renters on Hausto choose them ("District 2"), and
// vn_district_code resolves the label.
const NAMED_DISTRICTS = /\b(binh thanh|phu nhuan|tan binh|go vap|tan phu|binh tan)\b/;
const NEIGHBOURHOODS: [RegExp, string][] = [
  [/\b(thao dien|an phu|thu thiem|binh an|an khanh|binh trung|sala)\b/, 'District 2'],
  [/\b(phu my hung|tan phong)\b/, 'District 7'],
];

function ascii(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

function districtNamedIn(context: string): string {
  const text = ascii(context).toLowerCase().replace(/[-_]+/g, ' ');
  const n = text.match(/\b(?:district|quan)\s+(\d{1,2})\b/);
  if (n) return `District ${Number(n[1])}`;
  const named = text.match(NAMED_DISTRICTS)?.[1];
  if (named) return `${named.replace(/\b\w/g, (c) => c.toUpperCase())} District`;
  return NEIGHBOURHOODS.find(([re]) => re.test(text))?.[1] ?? '';
}

/** "Saigon Pavillon Quận 3" -> "Saigon Pavillon": the district is written once, later. */
function withoutDistrictSuffix(name: string): string {
  return name.replace(/\s+(?:qu[aậ]n\s*|q\.?\s*)\d{1,2}$/iu, '').trim();
}

/**
 * The building's district as an English label. The CRM writes the same
 * district three ways - "Quận 2", a bare "2", and named districts as
 * themselves ("Bình Thạnh") - and leaves a few blank.
 */
export function jhouseDistrict(raw: unknown, context = ''): string {
  const d = String(raw ?? '').trim();
  const n = d.match(/^(?:qu[aậ]n|district|q\.?)?\s*(\d{1,2})$/iu);
  if (n) return `District ${Number(n[1])}`;
  if (d) {
    const name = ascii(d).replace(/^(quan|huyen|district)\s+/i, '').trim();
    if (/^thu duc/i.test(name)) return 'Thu Duc City';
    return `${name} District`;
  }
  return districtNamedIn(context);
}

/**
 * "Rome Apartment, A22 Nguyen Van Huong, District 2, Ho Chi Minh City".
 *
 * `public_address` is the street with the district appended ("Phú Mỹ, Bình
 * Thạnh", "Đường Cao Thắng, 3") and the house number cut, sometimes leaving
 * its tail behind ("/A22 Nguyễn Văn Hưởng"). The district is dropped from it
 * and written once, in English, so vn_district_code always finds one. Small
 * buildings are often named for their own address ("251 Bach Dang" on Bach
 * Dang), and then the name, being the more exact, stands alone.
 */
export function jhouseLocation(unit: JhouseUnit): string {
  const building = unit?.building ?? {};
  const rawDistrict = String(building.district ?? building.public_district ?? '').trim();
  const segments = String(building.public_address ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (segments.length > 1 && rawDistrict && ascii(segments[segments.length - 1]).toLowerCase() === ascii(rawDistrict).toLowerCase()) {
    segments.pop();
  }
  let street = segments.join(', ').replace(/^[\s/]+/, '').trim();
  let name = withoutDistrictSuffix(String(building.name ?? '').trim());
  const key = (s: string) => ascii(s).toLowerCase();
  if (name && street && key(street).includes(key(name))) name = '';
  else if (name && street && /^\d/.test(name) && key(name).endsWith(key(street))) street = '';
  const district = jhouseDistrict(rawDistrict, `${unit?.title_en ?? ''} ${unit?.slug_en ?? ''} ${street} ${name}`);
  const parts = [name, street, district, 'Ho Chi Minh City'].filter(Boolean);
  return normalizeLocationForEnglishDisplay(parts.join(', '));
}

/** The English description, without the heading that repeats the title. */
function descriptionOf(unit: JhouseUnit): string {
  const html = String(unit?.description_en || unit?.description || '')
    .replace(/^\s*<h1\b[^>]*>[\s\S]*?<\/h1>/i, '');
  return htmlToText(html) || String(unit?.seo_description_en ?? '').trim();
}

function amenitiesOf(unit: JhouseUnit): string[] {
  const all = [unit?.amenities, unit?.building_amenities]
    .flatMap((v) => (Array.isArray(v) ? v : []))
    .filter((a): a is string => typeof a === 'string')
    .map((a) => a.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  return all.filter((a) => {
    const k = a.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * The unit's terms from the CRM's own fields (checked on 2026-10-26 across 96
 * units on offer): `minimum_lease_months` (12, or 6 for serviced units),
 * `deposit_months` as text ("2", "1.5", "1-2"), `pet_policy` as a Vietnamese
 * sentence ("Không cho nuôi thú cưng"), and two fee lists - `included_services`
 * the rent covers, `excluded_fees` charged on top, each priced where the agency
 * says ("Government price", "4,000 VND/kWh") and null where it does not. The
 * description fills any field left blank.
 */
export function jhouseTerms(unit: JhouseUnit, now = new Date()): LeaseTerms {
  const availability = listingAvailability(jhouseAvailability(unit, now));
  const from = typeof unit?.available_from === 'string' ? unit.available_from.slice(0, 10) : '';
  const lease = Number(unit?.minimum_lease_months);
  const deposit = depositFromField(unit?.deposit_months);
  const included: Fee[] = (Array.isArray(unit?.included_services) ? unit.included_services : [])
    .filter((s: unknown): s is string => typeof s === 'string' && s.trim() !== '')
    .map((s: string) => ({ kind: feeKindOf(s), label: s.trim(), included: true, amount: null }));
  const extra: Fee[] = (Array.isArray(unit?.excluded_fees) ? unit.excluded_fees : [])
    .filter((f: JhouseUnit) => typeof f?.label === 'string' && f.label.trim() !== '')
    .map((f: JhouseUnit) => ({
      kind: feeKindOf(f.label), label: f.label.trim(), included: false, amount: feeAmountFromField(f.value),
    }));
  return mergeTerms({
    availability,
    // Only a date still ahead: an "upcoming" unit whose date has passed is
    // free soon by the CRM's word, and a past date would say otherwise.
    availableFrom: availability === 'AVAILABLE_SOON' && /^\d{4}-\d{2}-\d{2}$/.test(from) && from > hcmcDay(now) ? from : null,
    minLeaseMonths: Number.isInteger(lease) && lease >= 1 && lease <= 60 ? lease : null,
    depositMonthsMin: deposit?.[0] ?? null,
    depositMonthsMax: deposit?.[1] ?? null,
    petsAllowed: petsFromField(unit?.pet_policy),
    fees: [...included, ...extra],
  }, readTermsFromText(descriptionOf(unit), now));
}

const MEDIA = /^https:\/\/media\.jhouse\.vn\/[^\s"']+\.(?:jpe?g|png|webp)$/i;

/** The unit's own gallery, cover first. `same_building_units` and `similar_units` carry photos too, and are never read. */
export function jhouseGallery(unit: JhouseUnit): string[] {
  const urls = [
    unit?.cover_image,
    ...(Array.isArray(unit?.images) ? unit.images : []),
  ].filter((u): u is string => typeof u === 'string' && MEDIA.test(u));
  return [...new Set(urls)];
}

/**
 * The number printed on the ad - the agency's switchboard, the one the page
 * offers on WhatsApp and Zalo (it carries no `tel:` link). Read off the page
 * rather than written in here, so a change on their side reaches us.
 */
export function jhouseAdPhone(html: string): string | null {
  const tel = firstTelLink(html);
  if (tel) return tel;
  const wa = html.match(/https:\/\/wa\.me\/(\d{9,13})/i)?.[1];
  if (wa) return `+${wa}`;
  return html.match(/https:\/\/zalo\.me\/(0\d{9})\b/i)?.[1] ?? null;
}

/**
 * A unit's record as one listing - or why it is not one.
 *
 * Rejected rather than stored: a rented unit, anything that is not a home,
 * and anything with no rent.
 */
export function buildJhouseListing(unit: JhouseUnit, phone?: string | null, now = new Date()): BuildResult {
  const availability = jhouseAvailability(unit, now);
  if (availability === 'RENTED') return { rejected: 'source_rented' };
  if (!isHome(unit)) return { rejected: 'non_residential' };
  const rent = rentOf(unit);
  if (!rent) return { rejected: 'no_price' };

  const title = decodeEntities(String(unit?.title_en || unit?.title || '')).replace(/\s+/g, ' ').trim();
  const beds = Number.isInteger(unit?.bedrooms) ? unit.bedrooms as number : null;
  const sqm = Number(unit?.area);

  const listing: AgencyListing = {
    title: title || 'Rental Property',
    location: jhouseLocation(unit),
    price: rent.price,
    priceDisplay: rent.priceDisplay,
    size: Number.isFinite(sqm) && sqm > 0 ? `${sqm} m²` : 'N/A',
    rooms: roomsLabel(beds, beds === 0 || /\bstudio\b/i.test(title)),
    images: jhouseGallery(unit),
    description: descriptionOf(unit),
    amenities: amenitiesOf(unit),
    availability,
    terms: jhouseTerms(unit, now),
    sourceProviderName: 'J.House',
    sourceProviderPhone: phone ?? undefined,
  };
  return { listing };
}

/** Record and the ad's own phone number, assembled. */
export async function buildJhouseFromUrl(url: string): Promise<BuildResult> {
  const [{ status, unit }, phone] = await Promise.all([
    fetchJhouseUnit(url),
    fetchPage(url).then((p) => (p.status === 200 ? jhouseAdPhone(p.text) : null)).catch(() => null),
  ]);
  if (!unit) return { rejected: status === 404 ? 'source_not_found' : `source_http_${status}` };
  return buildJhouseListing(unit, phone);
}

/** Still in the CRM, not rented, and at what rent. */
export async function verifyJhouse(url: string): Promise<AgencyVerification> {
  try {
    const { status, unit } = await fetchJhouseUnit(url);
    if (status === 404 || status === 410) return { status: 'dead', reason: 'source_not_found' };
    // A failing API says nothing about the listing.
    if (!unit) return { status: 'error', reason: `http_${status}` };
    if (jhouseAvailability(unit) === 'RENTED') return { status: 'dead', reason: 'source_rented' };
    const rent = rentOf(unit);
    const terms = jhouseTerms(unit);
    return rent ? { status: 'alive', livePrice: rent.price, liveDisplay: rent.priceDisplay, terms } : { status: 'alive', terms };
  } catch (e) {
    return { status: 'error', reason: (e as Error).message };
  }
}
