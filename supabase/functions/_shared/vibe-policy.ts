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
