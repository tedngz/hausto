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

export async function fetchNhatotMedia(
  url: string,
): Promise<{ images: string[]; videos: PropertyVideo[] }> {
  const empty = { images: [] as string[], videos: [] as PropertyVideo[] };
  const adId = extractNhatotAdId(url);
  if (!adId) return empty;
  try {
    const res = await fetch(`${CHOTOT_AD_API}/${adId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 HaustoBot' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.warn(`[nhatot] ad-listing API returned ${res.status} for ${adId}`);
      return empty;
    }
    const ad = (await res.json())?.ad;
    if (!ad) return empty;

    // `images` is the gallery in listing order; `image` is the cover, which is
    // usually already in it. Appended rather than assumed, then deduped.
    const images = [...new Set(
      (Array.isArray(ad.images) ? ad.images : [])
        .concat(typeof ad.image === 'string' ? [ad.image] : [])
        .filter((u: unknown): u is string => typeof u === 'string' && u.startsWith('http')),
    )].filter(u => !isVideoOrAnimatedUrl(u) && !isMapOrDiagramUrl(u));

    const videos: PropertyVideo[] = (Array.isArray(ad.videos) ? ad.videos : [])
      .filter((v: any) => v && typeof v.url === 'string')
      .map((v: any) => ({
        url: v.url,
        thumbnail: typeof v.thumbnail === 'string' ? v.thumbnail : null,
        source: 'nhatot',
      }));

    console.log(`[nhatot] ad ${adId}: ${images.length} gallery image(s), ${videos.length} video(s) from the public API`);
    return { images, videos };
  } catch (e) {
    console.warn(`[nhatot] ad-listing API failed for ${adId}:`, e);
    return empty;
  }
}
