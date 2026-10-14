// rentapartment.vn - an HCMC agency's WordPress site (Houzez theme).
//
// The theme publishes its listings through the WordPress REST API as the
// `property` post type, with everything a listing needs as typed fields:
// rent, size, bedrooms, the full address, coordinates, the gallery as
// attachment ids, and an availability label. The label is what makes this
// source worth more than its page count - 1,229 "Available" against 25
// "Rented" when it was added (2026-10-14) - because the feed can be asked for
// available units only, newest first:
//
//   /wp-json/wp/v2/properties?property_label=50&orderby=date&order=desc
//
// A listing URL is the post's permalink, ending in the agency's own reference
// number: /charming-serviced-apartment-on-tran-cao-van-street-id-2249/ (older
// posts drop the "id-": /cozy-serviced-apartment-on-nguyen-van-troi-2059/).
// Everything else on the site - /apartment-for-rent-district-3/,
// /the-gold-view-for-rent/ - is an archive of many units and is never a listing.

import {
  type AgencyListing, type AgencyVerification, type BuildResult, type FeedCandidate,
  decodeEntities, districtKey, fetchJson, fetchPage, firstTelLink, htmlToText,
  parseAmount, prioritise, rentToVnd, roomsLabel,
} from './agency-feeds.ts';

export const RENTAPARTMENT_ORIGIN = 'https://rentapartment.vn';
const API = `${RENTAPARTMENT_ORIGIN}/wp-json/wp/v2`;

// Term ids of the `property_label` taxonomy. Read from
// /wp-json/wp/v2/property_label on 2026-10-14; a third term, "Furnished", is
// mislabelled furnishing and carries no availability meaning.
export const LABEL_AVAILABLE = 50;
export const LABEL_RENTED = 51;

// `property_type` 5 is Office. The other four (Apartment, Serviced Apartment,
// House, Villa) are homes.
const TYPE_OFFICE = 5;

// `property_state` is the agency's district taxonomy. Keyed by the crawl
// rotation's districts (scheduled-crawl CRAWL_LOCATIONS); Thủ Đức covers what
// the site still files as District 2, Thao Dien and Thu Thiem, and District 7
// includes Phu My Hung, which the site tags separately. A district missing
// here - or a term the site renumbers - only widens the run to the whole feed;
// a listing's district is always read from its own address, never from this.
const DISTRICT_TERMS: Record<string, number[]> = {
  'quan 1': [26],
  'quan 3': [28],
  'quan 4': [29],
  'quan 7': [32, 59],
  'quan 10': [39],
  'binh thanh': [33],
  'phu nhuan': [61],
  'tan binh': [37],
  'go vap': [34],
  'thu duc': [27, 58, 6036],
};

// Names for the same terms, used only when an address omits its district.
const TERM_NAMES: Record<number, string> = {
  26: 'District 1', 27: 'District 2', 28: 'District 3', 29: 'District 4',
  32: 'District 7', 33: 'Binh Thanh District', 34: 'Go Vap District',
  36: 'Tan Phu District', 37: 'Tan Binh District', 39: 'District 10',
  58: 'Thao Dien, District 2', 59: 'Phu My Hung, District 7',
  61: 'Phu Nhuan District', 6036: 'Thu Thiem, District 2',
};

// The meta keys a listing is built from. Asked for by name: the full
// `property_meta` carries per-day view counters and runs to ~20 KB a listing.
const META_KEYS = [
  'fave_property_id', 'fave_property_price', 'fave_property_price_postfix',
  'fave_property_size', 'fave_property_size_prefix', 'fave_property_bedrooms',
  'fave_property_bathrooms', 'fave_property_address', 'fave_property_map_address',
  'houzez_geolocation_lat', 'houzez_geolocation_long', 'fave_property_images',
  'fave_multi_units',
];

const RECORD_FIELDS = [
  'id', 'date_gmt', 'modified_gmt', 'link', 'slug', 'title', 'content',
  'property_label', 'property_type', 'property_state',
  ...META_KEYS.map((k) => `property_meta.${k}`),
].join(',');

// The rent and the unit table ride along so a run can skip, before building
// anything, what it would refuse anyway: below the crawl's price floor, or a
// multi-unit ad.
const FEED_FIELDS = [
  'id', 'date_gmt', 'link', 'title', 'property_label',
  'property_meta.fave_property_price', 'property_meta.fave_multi_units',
].join(',');

// deno-lint-ignore no-explicit-any
export type RentapartmentRecord = Record<string, any>;

/** "ra2249", from the permalink's trailing reference number. */
export function extractRentapartmentId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith('rentapartment.vn')) return null;
    const m = u.pathname.match(/^\/[a-z0-9-]+-(?:id-)?(\d{3,5})\/?$/i);
    return m ? `ra${m[1]}` : null;
  } catch {
    return null;
  }
}

export function isRentapartmentListingUrl(url: string): boolean {
  return extractRentapartmentId(url) !== null;
}

function slugOf(url: string): string | null {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).pop() ?? null;
  } catch {
    return null;
  }
}

/** Newest available listings first, narrowed to the run's district where the site has one. */
export function rentapartmentFeedUrl(location?: string, page = 1, perPage = 100): string {
  const params = new URLSearchParams({
    property_label: String(LABEL_AVAILABLE),
    orderby: 'date',
    order: 'desc',
    per_page: String(perPage),
    page: String(page),
    _fields: FEED_FIELDS,
  });
  const terms = DISTRICT_TERMS[districtKey(location)];
  if (terms) params.set('property_state', terms.join(','));
  return `${API}/properties?${params}`;
}

/**
 * Feed rows as crawl candidates. Every row is already "Available" - the feed
 * asks for nothing else. Multi-unit ads are dropped here: they would be
 * refused once built, and a refused listing is never stored, so it would
 * stay "new" and take a slot on every run.
 */
export function candidatesFromFeed(rows: RentapartmentRecord[]): FeedCandidate[] {
  return prioritise(
    (Array.isArray(rows) ? rows : [])
      .filter((r) => typeof r?.link === 'string' && isRentapartmentListingUrl(r.link))
      .filter((r) => multiUnitPrices(r).length <= 1)
      .map((r) => {
        const amount = parseAmount(meta(r, 'fave_property_price'));
        return {
          url: r.link,
          title: typeof r.title?.rendered === 'string' ? decodeEntities(r.title.rendered) : undefined,
          availability: labelsOf(r).includes(LABEL_RENTED) ? 'RENTED' : 'AVAILABLE_NOW',
          postedAt: typeof r.date_gmt === 'string' ? `${r.date_gmt}Z` : undefined,
          priceVnd: amount !== null ? rentToVnd(amount)?.price : undefined,
        } satisfies FeedCandidate;
      }),
  );
}

export async function discoverRentapartment(location?: string, pages = 1): Promise<FeedCandidate[]> {
  const rows: RentapartmentRecord[] = [];
  for (let page = 1; page <= Math.max(1, pages); page++) {
    const { status, data } = await fetchJson<RentapartmentRecord[]>(rentapartmentFeedUrl(location, page));
    // WordPress answers a page past the end with 400 rest_post_invalid_page_number.
    if (!Array.isArray(data)) {
      if (page === 1) throw new Error(`rentapartment feed returned HTTP ${status}`);
      break;
    }
    rows.push(...data);
    if (data.length === 0) break;
  }
  console.log(`[rentapartment] feed: ${rows.length} available listing(s)${DISTRICT_TERMS[districtKey(location)] ? ` in ${location}` : ''}`);
  return candidatesFromFeed(rows);
}

/** One listing's record, by its permalink. Null when the post is gone (trashed, unpublished). */
export async function fetchRentapartmentRecord(url: string): Promise<{ status: number; record: RentapartmentRecord | null }> {
  const slug = slugOf(url);
  if (!slug) return { status: 0, record: null };
  const { status, data } = await fetchJson<RentapartmentRecord[]>(
    `${API}/properties?slug=${encodeURIComponent(slug)}&_fields=${RECORD_FIELDS}`,
  );
  return { status, record: Array.isArray(data) && data.length > 0 ? data[0] : null };
}

// ─── Building a listing from a record ────────────────────────────────────

function meta(record: RentapartmentRecord, key: string): string {
  const v = record?.property_meta?.[key];
  const first = Array.isArray(v) ? v[0] : v;
  return typeof first === 'string' || typeof first === 'number' ? String(first).trim() : '';
}

function labelsOf(record: RentapartmentRecord): number[] {
  return Array.isArray(record?.property_label) ? record.property_label.map(Number) : [];
}

/** Gallery attachment ids, in the order the agent arranged them. */
export function galleryIds(record: RentapartmentRecord): number[] {
  const v = record?.property_meta?.fave_property_images;
  return (Array.isArray(v) ? v : [])
    .map((x: unknown) => parseInt(String(x), 10))
    .filter((n: number) => Number.isFinite(n) && n > 0);
}

/**
 * The rents a multi-unit ad quotes. Houzez stores the unit table PHP-serialised:
 * `s:13:"fave_mu_price";s:3:"350";`. Read with a regex rather than a PHP
 * unserialiser - the price is the only field that matters, and only to count.
 */
export function multiUnitPrices(record: RentapartmentRecord): number[] {
  const raw = meta(record, 'fave_multi_units');
  const prices = [...raw.matchAll(/"fave_mu_price";s:\d+:"([^"]*)"/g)]
    .map((m) => parseAmount(m[1]))
    .filter((n): n is number => n !== null);
  return [...new Set(prices)];
}

function titleOf(record: RentapartmentRecord): string {
  const raw = decodeEntities(String(record?.title?.rendered ?? ''));
  // "Charming Serviced Apartment On Tran Cao Van Street – ID: 2249"
  return raw.replace(/\s*[-–—]\s*ID:?\s*\d+\s*$/i, '').replace(/\s+/g, ' ').trim();
}

/**
 * "Tran Cao Van, Ward 11, Phu Nhuan District, Ho Chi Minh" as the site writes
 * it. Since the 2025 ward merger some addresses name only the ward ("Pham Ngoc
 * Thach Street, Xuan Hoa Ward, Ho Chi Minh" - 6 of the newest 100), and
 * without a district vn_district_code is NULL and the listing can never be
 * shortlisted. The agency's own district term fills the gap.
 */
function locationOf(record: RentapartmentRecord): string {
  const district = (Array.isArray(record?.property_state) ? record.property_state : [])
    .map((id: unknown) => TERM_NAMES[Number(id)])
    .find(Boolean);
  const street = (meta(record, 'fave_property_map_address') || meta(record, 'fave_property_address'))
    .replace(/(,\s*(Ho Chi Minh(\s+City)?|HCMC?|Saigon|Vietnam))+\s*$/i, '')
    .trim();
  const named = /district|quan|binh thanh|phu nhuan|tan binh|go vap|tan phu|thu duc/i.test(street);
  return [street, named ? '' : district, 'Ho Chi Minh City'].filter(Boolean).join(', ');
}

function coordinate(raw: string, min: number, max: number): number | undefined {
  const n = parseFloat(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
}

/**
 * A record and its gallery as one listing - or why it is not one.
 *
 * Rejected rather than stored: a rented unit, an office, an ad quoting several
 * unit types at different rents (the photos show one of them and we cannot
 * tell which rent goes with them - the batch-ad rule in vibe-policy.ts), and
 * anything with no rent.
 */
export function buildRentapartmentListing(
  record: RentapartmentRecord,
  images: string[],
  phone?: string | null,
): BuildResult {
  if (labelsOf(record).includes(LABEL_RENTED)) return { rejected: 'source_rented' };
  const types = Array.isArray(record?.property_type) ? record.property_type.map(Number) : [];
  if (types.includes(TYPE_OFFICE)) return { rejected: 'non_residential' };
  if (multiUnitPrices(record).length > 1) return { rejected: 'multi_unit_ad' };

  const amount = parseAmount(meta(record, 'fave_property_price'));
  const rent = amount !== null ? rentToVnd(amount) : null;
  if (!rent) return { rejected: 'no_price' };

  const title = titleOf(record) || 'Rental Property';
  const beds = parseInt(meta(record, 'fave_property_bedrooms'), 10);
  const isStudio = /\bstudio\b/i.test(`${title} ${record?.slug ?? ''}`);
  const sqm = parseAmount(meta(record, 'fave_property_size'));

  return {
    listing: {
      title,
      location: locationOf(record),
      price: rent.price,
      priceDisplay: rent.priceDisplay,
      size: sqm ? `${sqm} m²` : 'N/A',
      rooms: roomsLabel(Number.isFinite(beds) ? beds : null, isStudio),
      images,
      description: htmlToText(String(record?.content?.rendered ?? '')),
      amenities: [],
      availability: 'AVAILABLE_NOW',
      sourceProviderName: 'Rentapartment Agency',
      sourceProviderPhone: phone ?? undefined,
      latitude: coordinate(meta(record, 'houzez_geolocation_lat'), 8, 24),
      longitude: coordinate(meta(record, 'houzez_geolocation_long'), 102, 110),
    },
  };
}

/** Full-size gallery URLs, in gallery order. The media endpoint returns originals, never WordPress crops. */
export async function fetchRentapartmentGallery(record: RentapartmentRecord): Promise<string[]> {
  const ids = galleryIds(record).slice(0, 100);
  if (ids.length === 0) return [];
  const { data } = await fetchJson<{ id: number; source_url?: string; mime_type?: string }[]>(
    `${API}/media?include=${ids.join(',')}&per_page=100&_fields=id,source_url,mime_type`,
  );
  if (!Array.isArray(data)) return [];
  const byId = new Map(
    data
      .filter((m) => typeof m.source_url === 'string' && String(m.mime_type ?? 'image/').startsWith('image/'))
      .map((m) => [Number(m.id), m.source_url as string]),
  );
  return ids.map((id) => byId.get(id)).filter((u): u is string => !!u);
}

/** Record, gallery and the ad's own phone number, assembled. */
export async function buildRentapartmentFromUrl(url: string): Promise<BuildResult> {
  const { status, record } = await fetchRentapartmentRecord(url);
  if (!record) return { rejected: status >= 200 && status < 300 ? 'source_not_found' : `source_http_${status}` };
  const [images, phone] = await Promise.all([
    fetchRentapartmentGallery(record),
    fetchPage(url).then((p) => (p.status === 200 ? firstTelLink(p.text) : null)).catch(() => null),
  ]);
  return buildRentapartmentListing(record, images, phone);
}

/** Still listed, still "Available", and at what rent. */
export async function verifyRentapartment(url: string): Promise<AgencyVerification> {
  try {
    const { status, record } = await fetchRentapartmentRecord(url);
    // A failing API says nothing about the listing.
    if (status !== 200) return { status: 'error', reason: `http_${status}` };
    // The REST API returns [] for a post that was trashed or unpublished.
    if (!record) return { status: 'dead', reason: 'source_not_found' };
    if (labelsOf(record).includes(LABEL_RENTED)) return { status: 'dead', reason: 'source_rented' };
    const amount = parseAmount(meta(record, 'fave_property_price'));
    const rent = amount !== null ? rentToVnd(amount) : null;
    return rent
      ? { status: 'alive', livePrice: rent.price, liveDisplay: rent.priceDisplay }
      : { status: 'alive' };
  } catch (e) {
    return { status: 'error', reason: (e as Error).message };
  }
}
