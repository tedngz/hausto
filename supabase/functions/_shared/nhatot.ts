// nhatot.com (chotot) media extraction.
//
// nhatot renders its gallery client-side: the server HTML carries one preview
// image and nothing else. Scraping it therefore yielded exactly one image per
// listing, and the display floor rejected the listing as "too_few_images:1" -
// 891 times - even though those ads held 6 to 12 photos. Chotot's own public
// ad endpoint returns the full gallery and any walkthrough video as JSON, for
// free and without spending a Firecrawl fetch, so it is the source of truth
// for nhatot media.
import { isVideoOrAnimatedUrl, isMapOrDiagramUrl } from './vibe-policy.ts';
import { type LeaseTerms, readTermsFromText } from './lease-terms.ts';

// A video the source listing carries. Stored alongside the gallery; not
// mirrored, since these are HLS manifests on the source's own CDN.
export interface PropertyVideo {
  url: string;
  thumbnail: string | null;
  source: string;
}

const CHOTOT_AD_API = 'https://gateway.chotot.com/v1/public/ad-listing';

export function extractNhatotAdId(url: string): string | null {
  return url.match(/\/(\d{5,})\.htm/i)?.[1] ?? null;
}

// The ad payload, fetched once. Callers that want media and callers that want
// the structured fields share this so a listing costs one request, not two.
// Loosely typed on purpose: chotot adds keys without warning, and the fields
// we read are pulled out defensively below.
// deno-lint-ignore no-explicit-any
export type NhatotAd = Record<string, any>;

export async function fetchNhatotAd(url: string): Promise<NhatotAd | null> {
  const adId = extractNhatotAdId(url);
  if (!adId) return null;
  try {
    const res = await fetch(`${CHOTOT_AD_API}/${adId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 HaustoBot' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.warn(`[nhatot] ad-listing API returned ${res.status} for ${adId}`);
      return null;
    }
    const ad = (await res.json())?.ad;
    return ad && typeof ad === 'object' ? ad as NhatotAd : null;
  } catch (e) {
    console.warn(`[nhatot] ad-listing API failed for ${adId}:`, e);
    return null;
  }
}

export function mediaFromAd(ad: NhatotAd): { images: string[]; videos: PropertyVideo[] } {
  // `images` is the gallery in listing order; `image` is the cover, which is
  // usually already in it. Appended rather than assumed, then deduped.
  const images = [...new Set(
    (Array.isArray(ad.images) ? ad.images : [])
      .concat(typeof ad.image === 'string' ? [ad.image] : [])
      .filter((u: unknown): u is string => typeof u === 'string' && u.startsWith('http')),
  )].filter(u => !isVideoOrAnimatedUrl(u) && !isMapOrDiagramUrl(u));

  const videos: PropertyVideo[] = (Array.isArray(ad.videos) ? ad.videos : [])
    // deno-lint-ignore no-explicit-any
    .filter((v: any) => v && typeof v.url === 'string')
    // deno-lint-ignore no-explicit-any
    .map((v: any) => ({
      url: v.url,
      thumbnail: typeof v.thumbnail === 'string' ? v.thumbnail : null,
      source: 'nhatot',
    }));

  return { images, videos };
}

export async function fetchNhatotMedia(
  url: string,
): Promise<{ images: string[]; videos: PropertyVideo[] }> {
  const ad = await fetchNhatotAd(url);
  if (!ad) return { images: [], videos: [] };
  const media = mediaFromAd(ad);
  console.log(
    `[nhatot] ad ${extractNhatotAdId(url)}: ${media.images.length} gallery image(s), ` +
    `${media.videos.length} video(s) from the public API`,
  );
  return media;
}

// A listing built from the ad payload rather than from page text.
//
// nhatot renders client-side, so the detail scrape returns a shell: markdown
// too short to extract from, one cover image, and nothing else. The pipeline
// then fell through to search-page extraction, which sees only the card - one
// `preset:listing` cover per listing - and every candidate was rejected as
// "too_few_images:1". 894 of them, while the crawl reported success.
//
// The public ad endpoint already carries everything the LLM was being asked to
// guess, and carries it typed: price as an integer, rooms and size as numbers,
// the ward and district split out, coordinates, and the seller's account id.
// So nhatot skips extraction entirely - no Firecrawl fetch, no model call, and
// no hallucinated bedroom counts.
export interface NhatotListing {
  title: string;
  location: string;
  price: number;
  priceDisplay: string;
  size: string;
  rooms: string;
  images: string[];
  videos: PropertyVideo[];
  description: string;
  amenities: string[];
  /** Read from the seller's own text, before it is rewritten in English. */
  terms: LeaseTerms;
  sourceProviderName?: string;
  sourceAgentId?: string;
  latitude?: number;
  longitude?: number;
}

/**
 * The terms the seller wrote. The payload has no field for any of them -
 * its `parameters` are address, size, rooms and furnishing - so they are read
 * from the headline and the advert ("cọc 2 tháng", "không nuôi thú cưng").
 */
export function nhatotTerms(ad: NhatotAd, now = new Date()): LeaseTerms {
  const text = [ad.subject, ad.body].filter((s: unknown): s is string => typeof s === 'string').join('\n');
  return readTermsFromText(text, now);
}

function roomsLabel(rooms: unknown): string {
  const n = typeof rooms === 'number' ? rooms : parseInt(String(rooms ?? ''), 10);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n === 0) return 'Studio';
  return n === 1 ? '1 Bedroom' : `${n} Bedrooms`;
}

export function buildNhatotListing(ad: NhatotAd, url: string): NhatotListing | null {
  const { images, videos } = mediaFromAd(ad);

  // Price is dong per month, already numeric. A listing with no price cannot be
  // shortlisted and cannot be sanity-checked against a broker's quote later, so
  // it is not worth storing.
  const price = typeof ad.price === 'number' && ad.price > 0 ? ad.price : 0;
  if (!price) {
    console.log(`[nhatot] ${url}: no usable price on the ad payload`);
    return null;
  }

  // "Trương Quốc Dung, Phường 9, Quận Phú Nhuận, Tp Hồ Chí Minh" - assembled
  // from the parts chotot already keeps separate, so the district survives
  // rather than being parsed back out of prose later.
  const location = [ad.street_name, ad.ward_name, ad.area_name, ad.region_name]
    .filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0)
    .join(', ');

  const size = typeof ad.size === 'number' && ad.size > 0 ? `${ad.size} m²` : 'N/A';

  return {
    title: typeof ad.subject === 'string' && ad.subject.trim() ? ad.subject.trim() : 'Rental Property',
    location: location || 'Ho Chi Minh City',
    price,
    priceDisplay: typeof ad.price_string === 'string' && ad.price_string
      ? ad.price_string
      : `${price.toLocaleString()} VND`,
    size,
    rooms: roomsLabel(ad.rooms),
    images,
    videos,
    description: typeof ad.body === 'string' ? ad.body.trim() : '',
    amenities: [],
    terms: nhatotTerms(ad),
    sourceProviderName: typeof ad.account_name === 'string' ? ad.account_name : undefined,
    // The durable per-broker join key. `phone` on this payload is masked
    // ("098890****") and is deliberately not read - a masked number stored as a
    // real one would look resolved and be undialable.
    sourceAgentId: ad.account_oid ? String(ad.account_oid) : (ad.account_id ? String(ad.account_id) : undefined),
    latitude: typeof ad.latitude === 'number' ? ad.latitude : undefined,
    longitude: typeof ad.longitude === 'number' ? ad.longitude : undefined,
  };
}
