// Agency sites crawled from their own structured data.
//
// rentapartment.vn, vnrenthome.com and jhouse.vn are single-agency English
// sites, like housingsgn, but none needs what housingsgn costs. All answer a
// plain fetch (no Cloudflare, no client rendering), all publish the listing's
// facts in a machine-readable form - a WordPress REST feed, schema.org
// JSON-LD, and the JSON API jhouse's own pages render from - and all can list
// their stock newest first and say which units are still available. So, as
// with nhatot's ad payload, a listing is built from typed fields rather than
// guessed out of page text by a model, and none spends a Firecrawl credit
// (firecrawl-budget.ts).
//
// Each source module exports the same three things: a discovery pass that
// returns listing URLs in the order they should be crawled, a builder that
// turns one URL into a listing (or a reason not to store it), and a verifier
// that re-reads availability and price for verify-external-listings.

import { USD_TO_VND } from './price-mentions.ts';
import type { LeaseTerms, ListingAvailability } from './lease-terms.ts';

export const AGENCY_FEED_SOURCES = ['rentapartment', 'vnrenthome', 'jhouse'] as const;
export type AgencyFeedSource = typeof AGENCY_FEED_SOURCES[number];

export function isAgencyFeedSource(source: string): source is AgencyFeedSource {
  return (AGENCY_FEED_SOURCES as readonly string[]).includes(source);
}

/** Which agency site a stored row or URL belongs to, or null. */
export function agencySourceOf(source: string, url = ''): AgencyFeedSource | null {
  const s = `${source} ${url}`.toLowerCase();
  if (s.includes('rentapartment')) return 'rentapartment';
  if (s.includes('vnrenthome')) return 'vnrenthome';
  if (s.includes('jhouse')) return 'jhouse';
  return null;
}

// Availability as each site reports it, best first. The crawl takes new
// listings in this order, so a run with room for three takes the three newest
// units the agency says are free today before anything it is unsure about.
export type Availability = 'AVAILABLE_NOW' | 'AVAILABLE_SOON' | 'UNCONFIRMED' | 'RENTED';

const AVAILABILITY_RANK: Record<Availability, number> = {
  AVAILABLE_NOW: 0,
  AVAILABLE_SOON: 1,
  UNCONFIRMED: 2,
  RENTED: 3,
};

export interface FeedCandidate {
  url: string;
  title?: string;
  /** The price as the card or feed prints it, for logging only. */
  price?: string;
  availability: Availability;
  /** When the agency published it, if the feed says. ISO 8601. */
  postedAt?: string;
  /** The monthly rent in dong, where the feed or card shows it. Lets a run
   *  drop units outside the crawl's price band before they take a slot. */
  priceVnd?: number;
}

/**
 * Crawl order: available before uncertain, newest first within each. Rented
 * units are dropped - there is nothing to arrange a viewing of. Where a feed
 * gives no date, its own order stands (every feed is asked for newest first),
 * which is why the sort is stable rather than falling back to the URL.
 */
export function prioritise(candidates: FeedCandidate[]): FeedCandidate[] {
  const seen = new Set<string>();
  return candidates
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => {
      if (c.availability === 'RENTED' || seen.has(c.url)) return false;
      seen.add(c.url);
      return true;
    })
    .sort((a, b) => {
      const byAvailability = AVAILABILITY_RANK[a.c.availability] - AVAILABILITY_RANK[b.c.availability];
      if (byAvailability !== 0) return byAvailability;
      const ta = a.c.postedAt ? Date.parse(a.c.postedAt) : NaN;
      const tb = b.c.postedAt ? Date.parse(b.c.postedAt) : NaN;
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return tb - ta;
      return a.i - b.i;
    })
    .map(({ c }) => c);
}

/** One unit, in the shape scrape-marketplace saves. Mirrors NhatotListing. */
export interface AgencyListing {
  title: string;
  location: string;
  price: number;
  priceDisplay: string;
  size: string;
  rooms: string;
  images: string[];
  description: string;
  amenities: string[];
  availability: Availability;
  /** Deposit, minimum lease, fees, pets and when it is free, as the agency states them (lease-terms.ts). */
  terms: LeaseTerms;
  sourceProviderName?: string;
  sourceProviderPhone?: string;
  latitude?: number;
  longitude?: number;
}

/** Ours, as stored: UNCONFIRMED says nothing, and a RENTED unit is never stored. */
export function listingAvailability(a: Availability): ListingAvailability | null {
  return a === 'AVAILABLE_NOW' || a === 'AVAILABLE_SOON' ? a : null;
}

/** A listing, or the reason it is not one we store - logged to crawler_rejections. */
export type BuildResult = { listing: AgencyListing } | { rejected: string };

/** What verify-external-listings needs back: is it still on offer, and at what rent. */
export interface AgencyVerification {
  status: 'alive' | 'dead' | 'error';
  reason?: string;
  livePrice?: number;
  liveDisplay?: string;
  /** The terms as the agency states them today - they change as the unit's date nears. */
  terms?: LeaseTerms;
}

// ─── Shared parsing helpers ──────────────────────────────────────────────

/** rentapartment and vnrenthome quote dollars a month. A figure this large is already dong. */
const DONG_FLOOR = 100_000;

/**
 * Monthly rent in dong from the number an agency prints. Converted here, on
 * write, so `price` and `price_display` agree from the start - the housingsgn
 * rows that stored dollars are the reason canonical_price_vnd has to guess.
 */
export function rentToVnd(amount: number, currency = 'USD'): { price: number; priceDisplay: string } | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (currency.toUpperCase() === 'VND' || amount >= DONG_FLOOR) {
    const vnd = Math.round(amount);
    return { price: vnd, priceDisplay: `${vnd.toLocaleString('de-DE')} ₫/month` };
  }
  return {
    price: Math.round(amount * USD_TO_VND),
    priceDisplay: `$${amount.toLocaleString('en-US')}/month`,
  };
}

/** "1,136" / "1136.00" / "$ 540" -> 1136 / 1136 / 540. */
export function parseAmount(raw: unknown): number | null {
  const text = String(raw ?? '').replace(/[^\d.,]/g, '');
  if (!text) return null;
  // A comma or dot followed by exactly three digits is a thousands separator.
  const normalised = text.replace(/[.,](?=\d{3}(?:\D|$))/g, '').replace(',', '.');
  const n = parseFloat(normalised);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function roomsLabel(bedrooms: number | null, isStudio = false): string {
  if (isStudio && (bedrooms === null || bedrooms <= 1)) return 'Studio';
  if (bedrooms === null || !Number.isFinite(bedrooms) || bedrooms < 0) return '';
  if (bedrooms === 0) return 'Studio';
  if (bedrooms >= 4) return '4+ Bedrooms';
  return bedrooms === 1 ? '1 Bedroom' : `${bedrooms} Bedrooms`;
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '-', mdash: '-', hellip: '...', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"',
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    // House style is "-" in anything a renter reads; WordPress turns every
    // " - " into an en dash.
    .replace(/[\u2013\u2014]/g, '-');
}

/** Visible text of an HTML fragment, paragraphs kept as line breaks. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|svg)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The number printed on the ad, from its first `tel:` link. This is the
 * agency's own switchboard or the agent named on the listing - the number
 * invariant 4 lets a renter reveal - so it is read off the page rather than
 * looked up anywhere else.
 */
export function firstTelLink(html: string, after = 0): string | null {
  const m = html.slice(Math.max(0, after)).match(/href=["']tel:([^"']+)["']/i);
  if (!m) return null;
  const phone = decodeURIComponent(m[1]).replace(/[^\d+]/g, '');
  return phone.length >= 9 ? phone : null;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** A plain GET. No agency site blocks one, so no Firecrawl is involved. */
export async function fetchPage(url: string, accept = 'text/html'): Promise<{ status: number; url: string; text: string }> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en-US,en;q=0.9' },
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
  });
  return { status: res.status, url: res.url || url, text: await res.text() };
}

export async function fetchJson<T>(url: string): Promise<{ status: number; data: T | null }> {
  const page = await fetchPage(url, 'application/json');
  if (page.status < 200 || page.status >= 300) return { status: page.status, data: null };
  try {
    return { status: page.status, data: JSON.parse(page.text) as T };
  } catch {
    return { status: page.status, data: null };
  }
}

/** The crawl-rotation district as an ASCII key: "Quận 7" -> "quan 7". */
export function districtKey(location?: string): string {
  return (location || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}
