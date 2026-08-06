// Listing-quality and vibe-analysis policy, shared by every function that
// either produces image highlights (process-vibe-queue) or decides whether a
// listing still needs them (backfill-image-highlights).
//
// These MUST live in one place. When they were duplicated as literals, the
// producer wrote ANALYZE_COUNT highlights while the consumer required
// min(images, 5), so every processed listing was immediately reclassified as
// "missing highlights" and re-enqueued forever, paying for vision each pass.

// A crawled listing needs at least this many qualified photos to go live.
// Listings that can never reach it are left alone, not retried.
export const MIN_DISPLAY_IMAGES = 5;

// Keep up to this many images in the gallery.
export const STORE_TARGET = 8;

// Analyze every qualified image, capped here. Since MIN_DISPLAY_IMAGES gates
// what goes live, a live listing gets all 5 of its qualifying photos analyzed.
export const ANALYZE_COUNT = 5;

// How many highlights a listing is expected to have once fully processed.
//
// Legacy listings holding fewer than MIN_DISPLAY_IMAGES photos are complete at
// one highlight per image — they can never reach 5, so demanding 5 would retry
// them forever. This is the single definition of "done"; both the producer and
// the backfill's missing-highlights check derive from it.
export function expectedHighlightCount(imageCount: number): number {
  return Math.min(imageCount, ANALYZE_COUNT);
}

// A gallery must show more of the unit than of its surroundings: interior shots
// have to strictly outnumber outdoor ones (facades, pools, streets, aerials,
// balcony views shot from outside). Interiors are returned first so the cover
// photo is always a room, followed by at most (interiors - 1) outdoor shots.
//
// Returns an empty array when there is no interior shot at all - the caller
// treats that as a rejection, since a listing with no interior is not a listing
// of an apartment.
export function interiorMajority<T>(items: T[], isInterior: (item: T) => boolean): T[] {
  const interior = items.filter(isInterior);
  if (interior.length === 0) return [];
  const outdoor = items.filter(item => !isInterior(item));
  return [...interior, ...outdoor.slice(0, interior.length - 1)];
}

// ─── Batch-inventory ads ────────────────────────────────────────
// Agencies post one ad for a whole portfolio of units ("giỏ hàng 500 căn",
// "200 Apartments for Rent") illustrated with a promo card rather than photos
// of one apartment. A renter cannot view or book any specific unit from these,
// so they do not belong in the feed.
//
// The check runs over the SOURCE URL as well as the title and description: the
// crawler's LLM rewrite turns "sàn giỏ hàng 500 cho thuê các loại hình studio
// 1-2-3PN" into a tidy "Affordable Studio Apartment for Rent", but the slug
// still carries the giveaway.
const BATCH_INVENTORY_PATTERNS: RegExp[] = [
  // Vietnamese, accented and slug forms
  /gi(ỏ|o)[\s-]?h(à|a)ng/i,            // giỏ hàng / gio-hang (inventory basket)
  /qu(ỹ|y)[\s-]?(c(ă|a)n|ch(í|i)nh[\s-]?ch(ủ|u)|nh(à|a))/i, // quỹ căn / quỹ chính chủ (unit pool)
  /nhi(ề|e)u[\s-]?c(ă|a)n/i,           // nhiều căn (many units)
  /chuy(ê|e)n[\s-]?cho[\s-]?thu(ê|e)/i, // chuyên cho thuê (agency portfolio)
  /c(á|a)c[\s-]?lo(ạ|a)i[\s-]?h(ì|i)nh/i, // các loại hình (all unit types)
  /tung[\s-]?ra[\s-]?th(ị|i)[\s-]?tr(ư|u)(ờ|o)ng/i,
  /\d{3,}\s*(h(ộ|o)|c(ă|a)n)\b/i,      // "2000 hộ", "500 căn"
  /(^|[\s-])(1|studio)[\s-]?[-,]?[\s-]?2[\s-]?[-,]?[\s-]?3([\s-]?[-,]?[\s-]?4)?[\s-]?(pn|phong[\s-]?ngu|ph(ò|o)ng[\s-]?ng(ủ|u))/i, // 1-2-3PN
  // English, as produced by the extraction step
  /\b\d{2,4}\s+(apartments|units)\b/i, // "200 Apartments"
  /\brental apartments\b/i,
  /\bapartments for rent\b/i,
  /\ball (unit )?types\b/i,
  /\bfrom studio to\b/i,
  /\b(multiple|various|many) (units|apartments|layouts)\b/i,
];

export function isBatchInventoryListing(...texts: (string | null | undefined)[]): boolean {
  const haystack = texts.filter(Boolean).join(' \n ');
  if (!haystack) return false;
  return BATCH_INVENTORY_PATTERNS.some(re => re.test(haystack));
}

// A vision model asked "is this a map?" will call an aerial photograph a map
// view often enough to matter, and that label deletes an image. So the label
// only counts when the model can name the drawn elements it saw, and that
// reason must not itself be describing photography. Anything unconvincing is
// demoted to "outdoor", where the interior-majority rule decides its fate -
// a wrongly demoted photo costs a gallery slot, a wrongly deleted one is gone.
const PHOTO_WORDS = /\b(aerial|drone|bird'?s[- ]eye|skyline|panorama|photo|photograph|view of|rooftop|overlook|cityscape|landscape)\b/i;
const GRAPHIC_WORDS = /\b(map|plan|drawing|diagram|render|icon|marker|pin|arrow|scale bar|legend|label|text|logo|watermark|chart|grid|blueprint|layout|timecode|play button|thumbnail|collage|card)\b/i;

export function isCredibleMapLabel(flagged: boolean, why: string): boolean {
  if (!flagged) return false;
  const reason = (why || '').trim();
  if (!reason) return false;
  if (PHOTO_WORDS.test(reason)) return false;
  return GRAPHIC_WORDS.test(reason);
}

// Video and animated formats are never property photography, and map/floor-plan
// graphics are not photographs of the unit. Both are rejected on the URL before
// anything is fetched. Kept here so every crawler applies the same rule.
export function isVideoOrAnimatedUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (/\.(mp4|avi|mov|wmv|flv|mkv|webm|m3u8|ts|m4v|3gp|mpe?g|ogv)(\?|$)/i.test(lower)) return true;
  if (/\.(gif|apng)(\?|$)/i.test(lower)) return true;
  if (/\/(videos?|clips?|reels?|stories)\//i.test(lower)) return true;
  if (/(youtube\.com|youtu\.be|vimeo\.com|giphy\.com|tenor\.com)/i.test(lower)) return true;
  return false;
}

// Source CDNs encode the rendition size in the path (batdongsan serves
// /crop/140x140/ next to /resize/1275x717/ of the same photo). A thumbnail
// blown up to fill a card is the blurry-listing complaint, so anything under
// the display width is rejected before it can be stored.
const MIN_SOURCE_WIDTH = 600;

export function isThumbnailUrl(url: string): boolean {
  const m = url.toLowerCase().match(/\/(?:crop|resize|thumb|thumbs|w)\/(\d{2,4})x(\d{2,4})\//);
  if (!m) return false;
  return Number(m[1]) < MIN_SOURCE_WIDTH;
}

export function isMapOrDiagramUrl(url: string): boolean {
  const lower = url.toLowerCase();
  // Map providers and static-map endpoints
  if (/(maps?\.google|googleapis\.com\/maps|staticmap|mapbox|openstreetmap|\.tile\.|tile\.openstreetmap|here\.com\/maptile|goong\.io)/i.test(lower)) return true;
  // "map" as its own path/filename token, incl. the Vietnamese slugs these
  // sites use: ban-do = bản đồ (map), so-do = sơ đồ (diagram),
  // mat-bang = mặt bằng (floor plan), vi-tri = location diagram.
  // Matched as whole tokens so "mapleleaf-tower" or "cesar-map-street" survive.
  if (/(^|[/_-])(maps?|ban-?do|so-?do|mat-?bang|vi-?tri|floor-?plans?)([/_-]|\.|$)/i.test(lower)) return true;
  return false;
}
