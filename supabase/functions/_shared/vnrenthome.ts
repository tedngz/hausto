// vnrenthome.com - an HCMC agency's own site (Laravel, server-rendered).
//
// Its listing index sorts newest first on request and badges every card with
// the unit's availability:
//
//   /listing.html?sort=created_at:desc&location=7&page=2
//
//   bg-status-1  "Available Now"       schema.org InStock
//   bg-status-2  "Available Soon"
//   bg-status-0  "Check Availability"  schema.org LimitedAvailability
//
// A listing is /v<id>/<slug>.html, ids rising with age (v3763 was the newest
// on 2026-10-14). Projects (/p59/...) and articles (/c1/...) are not listings.
// The detail page carries a schema.org JSON-LD block with the rent, currency,
// address, availability and gallery, and a lightbox scoped to the listing
// (`data-fslightbox="prop-3763-gallery"`). The gallery is read from those two
// only, so the "Similar properties" thumbnails on the same page never leak in.
// Newer listings also keep their photos under a directory named for the id
// (/storage/uploads/2026/10/3763/...); older ones do not
// (/storage/uploads/products/SA/Binh%20Thanh/...), which is why the path is
// only a fallback.

import {
  type Availability, type AgencyListing, type AgencyVerification, type BuildResult, type FeedCandidate,
  decodeEntities, districtKey, fetchPage, firstTelLink, htmlToText, parseAmount, prioritise,
  rentToVnd, roomsLabel,
} from './agency-feeds.ts';

export const VNRENTHOME_ORIGIN = 'https://vnrenthome.com';

// The index's `location` filter ids, from its own <select name="location">
// (2026-10-14). Keyed by the crawl rotation's districts; Thủ Đức is what the
// site still calls District 2 (Thao Dien, An Phu, Thu Thiem). An unmapped
// district - Gò Vấp has none - crawls the whole index instead, which is safe:
// a listing's district is read from its own page, never from this.
const LOCATION_IDS: Record<string, number> = {
  'quan 1': 7,
  'quan 3': 9,
  'quan 4': 10,
  'quan 7': 12,
  'quan 10': 14,
  'binh thanh': 16,
  'phu nhuan': 17,
  'tan binh': 18,
  'thu duc': 8,
};

/** "vr3763". */
export function extractVnrenthomeId(url: string): string | null {
  const m = url.match(/^https?:\/\/(?:www\.)?vnrenthome\.com\/v(\d+)\/[^/?#]+\.html/i);
  return m ? `vr${m[1]}` : null;
}

export function isVnrenthomeListingUrl(url: string): boolean {
  return extractVnrenthomeId(url) !== null;
}

export function vnrenthomeIndexUrl(location?: string, page = 1): string {
  const params = new URLSearchParams({ sort: 'created_at:desc' });
  const id = LOCATION_IDS[districtKey(location)];
  if (id) params.set('location', String(id));
  if (page > 1) params.set('page', String(page));
  return `${VNRENTHOME_ORIGIN}/listing.html?${params}`;
}

function availabilityOfBadge(status: string | undefined, text: string): Availability {
  if (/rented|leased|not available|sold/i.test(text)) return 'RENTED';
  if (status === '1' || /available now/i.test(text)) return 'AVAILABLE_NOW';
  if (status === '2' || /available soon|available from/i.test(text)) return 'AVAILABLE_SOON';
  return 'UNCONFIRMED';
}

/**
 * Cards on one index page, in page order (newest first). A card is the anchor
 * wrapping a /v<id>/ link; its badge and price sit inside it, before the next
 * card begins.
 */
export function parseVnrenthomeIndex(html: string): FeedCandidate[] {
  const anchor = /<a\b[^>]*href="(https:\/\/vnrenthome\.com\/v\d+\/[^"]+\.html)"[^>]*>/gi;
  const starts: { url: string; at: number; tag: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = anchor.exec(html)) !== null) starts.push({ url: m[1], at: m.index, tag: m[0] });

  const out: FeedCandidate[] = [];
  starts.forEach((s, i) => {
    const card = html.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : s.at + 6000);
    const badge = card.match(/bg-status-(\d+)[^>]*>\s*([^<]*?)\s*</i);
    const price = card.match(/text-orange-600[^>]*>\s*([\d.,]+\s*(?:USD|VND|₫))/i);
    const title = s.tag.match(/\btitle="([^"]+)"/i)?.[1];
    out.push({
      url: s.url,
      title: title ? decodeEntities(title) : undefined,
      price: price?.[1],
      availability: availabilityOfBadge(badge?.[1], badge?.[2] ?? ''),
    });
  });
  return out;
}

export async function discoverVnrenthome(location?: string, pages = 3): Promise<FeedCandidate[]> {
  const cards: FeedCandidate[] = [];
  for (let page = 1; page <= Math.max(1, pages); page++) {
    const res = await fetchPage(vnrenthomeIndexUrl(location, page));
    if (res.status !== 200) {
      if (page === 1) throw new Error(`vnrenthome index returned HTTP ${res.status}`);
      break;
    }
    const found = parseVnrenthomeIndex(res.text);
    if (found.length === 0) break;
    cards.push(...found);
  }
  const ordered = prioritise(cards);
  const now = ordered.filter((c) => c.availability === 'AVAILABLE_NOW').length;
  console.log(`[vnrenthome] index: ${cards.length} card(s), ${now} available now${LOCATION_IDS[districtKey(location)] ? ` in ${location}` : ''}`);
  return ordered;
}

// ─── Detail page ─────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
type JsonLd = Record<string, any>;

/** The JSON-LD node that describes the unit: the one with an offer. */
export function listingJsonLd(html: string): JsonLd | null {
  const blocks = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const [, body] of blocks) {
    try {
      const parsed = JSON.parse(body);
      const nodes: JsonLd[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.['@graph']) ? parsed['@graph'] : [parsed];
      const node = nodes.find((n) => n && typeof n === 'object' && n.offers);
      if (node) return node;
    } catch { /* a malformed block is skipped, not fatal */ }
  }
  return null;
}

function availabilityOfOffer(offer: JsonLd | undefined): Availability {
  const a = String(offer?.availability ?? '').toLowerCase();
  if (/soldout|outofstock|discontinued/.test(a)) return 'RENTED';
  if (/instock|instoreonly|onlineonly/.test(a)) return 'AVAILABLE_NOW';
  if (/preorder|presale|backorder/.test(a)) return 'AVAILABLE_SOON';
  return 'UNCONFIRMED';
}

/** The "Property details" grid: "2 Bedrooms", "Size 69 m2", "Pool", ... */
function detailItems(html: string): string[] {
  const start = html.search(/>\s*Property details\s*</i);
  if (start < 0) return [];
  const end = html.indexOf('accordion-toggle', start);
  const block = html.slice(start, end > start ? end : start + 8000);
  return [...block.matchAll(/<span[^>]*>\s*([^<]{1,60}?)\s*<\/span>/gi)]
    .map((m) => decodeEntities(m[1]).trim())
    .filter(Boolean);
}

const NOT_AN_AMENITY = /^\d+\s*(bed|bath)|^size\b|\bfloor\b|^studio$/i;

/** The "Description" accordion's text, cut before the agency's sign-off. */
function descriptionOf(html: string): string {
  const start = html.search(/class="[^"]*single-content-property[^"]*"/i);
  if (start < 0) return '';
  const rest = html.slice(start);
  const end = rest.search(/Google map|Similar properties|Agent Details/i);
  // Links into the site's own category pages ("apartments for rent in
  // District 1") are SEO, not description, and read as a portfolio ad to
  // isBatchInventoryListing. Their text goes; the sentence around it stays.
  const body = rest.slice(rest.indexOf('>') + 1, end > 0 ? end : 20000)
    .replace(/<a\b[^>]*href="https:\/\/vnrenthome\.com\/(?!v\d+\/)[^"]*"[^>]*>[\s\S]*?<\/a>/gi, '');
  const text = htmlToText(body);
  // "Ready to find your home ... Call / WhatsApp / Zalo: +84 ..." is the
  // agency's footer on every listing, not a description of this one.
  const signOff = text.search(/Ready to find your home|📞|Call \/ WhatsApp/i);
  return (signOff > 0 ? text.slice(0, signOff) : text).trim();
}

const UPLOAD = /^https:\/\/vnrenthome\.com\/storage\/uploads\/[^"'\s)]+\.(?:jpe?g|png|webp)$/i;

/**
 * The listing's own photos: its lightbox in page order (hero first), then any
 * the JSON-LD adds. Only where a page has neither does the id-named upload
 * directory stand in.
 */
export function vnrenthomeGallery(html: string, url: string, ld: JsonLd | null): string[] {
  const id = extractVnrenthomeId(url)?.slice(2);
  if (!id) return [];
  const lightbox = [...html.matchAll(/<a\b[^>]*data-fslightbox="([^"]*)"[^>]*>/gi)]
    .filter((m) => m[1] === `prop-${id}-gallery`)
    .map((m) => decodeEntities(m[0].match(/\bhref="([^"]+)"/i)?.[1] ?? ''));
  const fromLd: string[] = (Array.isArray(ld?.image) ? ld.image : typeof ld?.image === 'string' ? [ld.image] : [])
    .filter((u: unknown): u is string => typeof u === 'string');
  let gallery = [...new Set([...lightbox, ...fromLd])];
  if (gallery.length === 0) {
    const ownDir = new RegExp(`/storage/uploads/\\d{4}/\\d{2}/${id}/`, 'i');
    gallery = [...new Set(
      [...html.matchAll(/https:\/\/vnrenthome\.com\/storage\/uploads\/[^"'\s)]+?\.(?:jpe?g|png|webp)/gi)].map((m) => m[0]),
    )].filter((u) => ownDir.test(u));
  }
  return gallery.filter((u) => UPLOAD.test(u) && !/thumbnail/i.test(u));
}

// Areas expats name instead of a district. The site files them under the
// pre-2021 districts, as renters on Hausto choose them ("District 2"), and
// vn_district_code resolves the label.
const NEIGHBOURHOODS: [RegExp, string][] = [
  [/\b(thao dien|an phu|thu thiem|binh an|an khanh|binh trung)\b/i, 'District 2'],
  [/\b(phu my hung|tan phong)\b/i, 'District 7'],
];

/**
 * The district, from the Type link's path where it has one
 * (/serviced-apartment-ho-chi-minh-city/district-2/thao-dien.html), else its
 * text ("Apartment For Rent in District 1"), else a neighbourhood the address
 * names. Empty when none of them says.
 */
export function vnrenthomeDistrict(typeHref: string, typeText: string, street: string): string {
  try {
    const segments = new URL(typeHref).pathname.replace(/\.html$/i, '').split('/').filter(Boolean);
    const sub = segments[1];
    if (sub) {
      const n = sub.match(/^district-(\d{1,2})$/i);
      if (n) return `District ${Number(n[1])}`;
      if (!/ho-chi-minh/i.test(sub)) return sub.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
    }
  } catch { /* no usable link */ }
  const named = typeText.match(/\bin\s+(.+)$/i)?.[1]?.trim();
  if (named && !/ho chi minh/i.test(named)) return named;
  return NEIGHBOURHOODS.find(([re]) => re.test(street))?.[1] ?? '';
}

/**
 * One detail page as a listing - or why it is not one.
 *
 * Rejected rather than stored: a unit the page says is rented, anything filed
 * under "For Sale", and anything with no rent.
 */
export function parseVnrenthomeDetail(html: string, url: string): BuildResult {
  const ld = listingJsonLd(html);
  const offer: JsonLd | undefined = Array.isArray(ld?.offers) ? ld?.offers[0] : ld?.offers;
  const availability = availabilityOfOffer(offer);
  if (availability === 'RENTED') return { rejected: 'source_rented' };

  // "Type: <a href=".../apartment-for-rent-in-ho-chi-minh-city/district-1.html">Apartment For Rent in District 1</a>"
  const type = html.match(/<strong>\s*Type:\s*<\/strong>\s*<a[^>]*href="([^"]*)"[^>]*>\s*([^<]+?)\s*<\/a>/i);
  const typeText = type ? decodeEntities(type[2]) : '';
  if (/for[\s-]sale/i.test(`${type?.[1] ?? ''} ${typeText} ${url}`)) return { rejected: 'sale_listing' };

  const pagePrice = html.match(/text-orange-500[^>]*>\s*([\d.,]+)\s*(USD|VND)/i);
  const amount = parseAmount(offer?.price) ?? parseAmount(pagePrice?.[1]);
  const rent = amount !== null ? rentToVnd(amount, String(offer?.priceCurrency ?? pagePrice?.[2] ?? 'USD')) : null;
  if (!rent) return { rejected: 'no_price' };

  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const title = decodeEntities((h1 ? htmlToText(h1) : '') || String(ld?.name ?? '')).replace(/\s+/g, ' ').trim();

  const items = detailItems(html);
  const beds = items.map((t) => t.match(/^(\d+)\s*Bedrooms?$/i)).find(Boolean);
  const isStudio = items.some((t) => /^studio$/i.test(t)) || /\bstudio\b/i.test(title);
  const size = items.map((t) => t.match(/^Size\s*([\d.,]+)\s*m/i)).find(Boolean);
  const sqm = size ? parseAmount(size[1]) : null;
  const amenities = items.filter((t) => !NOT_AN_AMENITY.test(t));

  // The street address often names only the ward (since the 2025 merger) or
  // the neighbourhood, so the district is read separately - without one,
  // vn_district_code is NULL and the listing can never be shortlisted.
  const rawStreet = String(ld?.address?.streetAddress ?? '').replace(/\s+/g, ' ').trim()
    || decodeEntities(html.match(/<strong>\s*Address:\s*<\/strong>\s*<span[^>]*>([^<]*)</i)?.[1] ?? '').trim();
  // "02 Ton Duc Thang Street Saigon Ward HCMC", "Binh Thanh District - Ho Chi Minh City"
  const street = rawStreet.replace(/[\s,-]*(HCMC|Ho Chi Minh(\s+City)?)\s*$/i, '').trim();
  const district = vnrenthomeDistrict(type?.[1] ?? '', typeText, street);
  const location = [
    street,
    district && !street.toLowerCase().includes(district.toLowerCase()) ? district : '',
    'Ho Chi Minh City',
  ].filter(Boolean).join(', ');

  const agentAt = html.search(/Agent Details/i);
  const agentName = agentAt >= 0
    ? html.slice(agentAt, agentAt + 3000).match(/<p class="font-bold[^"]*"[^>]*>\s*([^<]+?)\s*<\/p>/i)?.[1]
    : undefined;

  const listing: AgencyListing = {
    title: title || 'Rental Property',
    location,
    price: rent.price,
    priceDisplay: rent.priceDisplay,
    size: sqm ? `${sqm} m²` : 'N/A',
    rooms: roomsLabel(beds ? Number(beds[1]) : null, isStudio),
    images: vnrenthomeGallery(html, url, ld),
    description: descriptionOf(html) || String(ld?.description ?? ''),
    amenities,
    availability,
    sourceProviderName: agentName ? decodeEntities(agentName) : 'Vietnam Rent Home',
    // The agent named on the listing first; the site-wide number otherwise.
    sourceProviderPhone: (agentAt >= 0 ? firstTelLink(html, agentAt) : null) ?? firstTelLink(html) ?? undefined,
  };
  return { listing };
}

export async function buildVnrenthomeFromUrl(url: string): Promise<BuildResult> {
  const page = await fetchPage(url);
  if (page.status !== 200) return { rejected: `source_http_${page.status}` };
  if (!isVnrenthomeListingUrl(page.url)) return { rejected: 'redirect_away' };
  return parseVnrenthomeDetail(page.text, url);
}

/** Still on the site, not marked rented, and at what rent. */
export async function verifyVnrenthome(url: string): Promise<AgencyVerification> {
  try {
    const page = await fetchPage(url);
    if (page.status === 404 || page.status === 410) return { status: 'dead', reason: `http_${page.status}` };
    if (page.status !== 200) return { status: 'error', reason: `http_${page.status}` };
    // A removed listing redirects to the index or the home page.
    if (extractVnrenthomeId(page.url) !== extractVnrenthomeId(url)) return { status: 'dead', reason: 'redirect_away' };
    const built = parseVnrenthomeDetail(page.text, url);
    if ('rejected' in built) {
      return built.rejected === 'source_rented' || built.rejected === 'sale_listing'
        ? { status: 'dead', reason: built.rejected }
        : { status: 'alive' };
    }
    return { status: 'alive', livePrice: built.listing.price, liveDisplay: built.listing.priceDisplay };
  } catch (e) {
    return { status: 'error', reason: (e as Error).message };
  }
}
