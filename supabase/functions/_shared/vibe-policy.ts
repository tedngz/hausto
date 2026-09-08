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

// Keep up to this many images in the gallery. A source listing carries the
// whole unit - every room, the building, the view - and truncating it at 8 threw
// away photos a renter deciding on the place would want. The cap only exists so
// one pathological listing cannot drag a crawl run out.
export const STORE_TARGET = 20;

// Analyze every stored image. Highlights are positional - one per photo, shown
// under it in the gallery - so anything below STORE_TARGET leaves later photos
// captionless.
export const ANALYZE_COUNT = STORE_TARGET;

// The analysis target before galleries were kept whole. Rows analysed under
// that policy carry no stamp, so this is what an unstamped row is judged
// against.
export const LEGACY_ANALYZE_COUNT = 5;

// Every completed analysis records the target it ran under. Without it, raising
// ANALYZE_COUNT would reclassify every already-finished listing as "missing
// highlights" and put the whole table back through vision - a policy change
// would cost a full re-analysis of the catalogue.
export function highlightPolicyOf(vibeAnalysis: unknown): number {
  const stamped = Number((vibeAnalysis as any)?.highlight_policy);
  return Number.isFinite(stamped) && stamped > 0 ? stamped : LEGACY_ANALYZE_COUNT;
}

// How many highlights a listing is expected to have once fully processed.
//
// Listings holding fewer than the target are complete at one highlight per
// image — they can never reach it, so demanding the full count would retry them
// forever. This is the single definition of "done"; both the producer and the
// backfill's missing-highlights check derive from it.
//
// Producers pass no policy and so analyse to the current one. Consumers deciding
// whether an EXISTING listing still needs work must pass highlightPolicyOf(row),
// which grandfathers anything finished under an earlier policy.
export function expectedHighlightCount(imageCount: number, policy: number = ANALYZE_COUNT): number {
  return Math.min(imageCount, policy);
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
  // "chỉ từ 6.5 triệu" / "giá từ 4tr" - a starting price quotes a range of
  // units, not the one being advertised
  /(ch(ỉ|i)|gi(á|a))[\s-]?t(ừ|u)[\s-]?\d/i,
  // Two or more prices in one ad ("1pn 18tr 2pn 29tr") is a portfolio, and
  // whichever one we picked would be the wrong number for the photos shown
  /\d{1,3}[\s-]?tr(?:ieu|iệu)?\b[\s\S]{1,40}?\d{1,3}[\s-]?tr(?:ieu|iệu)?\b/i,
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

// Magic-byte sniffing for payloads that are not still photographs. Source CDNs
// serve GIFs and video containers from extension-less URLs, so the bytes get
// the final say. Defined once here: it used to be copy-pasted into three
// functions, and the WebP branch was wrong in all three at the same time.
//
// WebP container layout (RIFF):
//   0..3   "RIFF"        8..11  "WEBP"       12..15 first chunk fourcc
//   16..19 chunk payload size (LE uint32)    20     VP8X flag byte
// Only the extended form (VP8X) can be animated, and the animation flag is
// bit 1 of the flag byte at offset 20. Offset 16 is the chunk size - always
// 0x0000000A for VP8X - and 0x0A & 0x02 is non-zero, so reading offset 16
// declares every WebP carrying alpha, ICC, EXIF or XMP to be animated.
//
// Even with the right offset, the flag alone does not delete a photo: an
// animated WebP must also carry an ANIM chunk, so a stray flag bit costs
// nothing.
export function isAnimatedOrVideoBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const ascii = (start: number, len: number) =>
    String.fromCharCode(...Array.from(bytes.subarray(start, start + len)));

  if (ascii(0, 4) === 'GIF8') return true;                       // GIF87a / GIF89a
  if (ascii(4, 4) === 'ftyp') return true;                       // MP4 / MOV / 3GP
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return true; // WebM/Matroska

  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    if (ascii(12, 4) !== 'VP8X') return false;   // plain VP8 / VP8L cannot animate
    if (bytes.length < 21) return false;
    if ((bytes[20] & 0x02) === 0) return false;  // animation flag clear
    // Corroborate with the chunk that actually holds the frames.
    const head = bytes.subarray(0, Math.min(bytes.length, 4096));
    for (let i = 0; i <= head.length - 4; i++) {
      if (head[i] === 0x41 && head[i + 1] === 0x4e && head[i + 2] === 0x49 && head[i + 3] === 0x4d) {
        return true;                             // "ANIM"
      }
    }
    return false;
  }
  return false;
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
