

## Analysis: Phase 3 vibe_analysis Token Waste

### Finding

Phase 3 (in `scrape-marketplace`) asks GPT-4o-mini to generate `vibe_analysis` (style, colors, activities, vibe_scores) and `highlights` from the listing's **text content**. However, for **new listings**, the post-save step 7 (in `crawl-external-properties`, lines 582-611) immediately overwrites all of these fields with **image-based** analysis from GPT-4o-mini Vision.

The only scenario where Phase 3 vibe data survives is for **existing/updated listings** (line 535 skips vibe re-analysis), but that data is text-based and lower quality than the image-based version.

### Impact on User Experience

- **Discovery ranking**: `vibeScoring.ts` uses `vibe_analysis.styles`, `colors`, and `activities` to calculate match scores. These come from the post-save image analysis for new listings, so Phase 3's version has zero impact.
- **Vibe badge display**: `VibeScore.tsx` reads styles/colors/activities for the popover breakdown — again sourced from the final stored values (post-save overwrites).
- **Vector search**: Embeddings are generated from title, description, location, amenities, and highlights — the highlights get overwritten too.
- **Per-image highlights**: Only the post-save step produces positional per-image highlights; Phase 3 produces generic text highlights.

### Recommendation: Remove vibe fields from Phase 3 prompt

**What to keep in Phase 3** (essential extraction, no duplication):
- title, location, price, priceDisplay, size, rooms, images, description, contactName, contactPhone, amenities

**What to remove from Phase 3** (duplicated and overwritten):
- vibe_analysis (style, colors, activities, vibe_scores)
- highlights (replaced by per-image highlights from step 7)

**Additional fix**: For existing/updated listings that currently skip vibe re-analysis (line 535), trigger vibe analysis if `vibe_analysis` is empty or missing `image_analyses`, so they also get image-based quality data.

### Token Savings Estimate

The Phase 3 prompt is ~800 tokens. Removing the vibe analysis section (~200 tokens from prompt + ~150 tokens from response) saves ~350 tokens per listing. At 5-10 listings per crawl run, that is 1,750-3,500 tokens saved per run.

### Changes

1. **`supabase/functions/scrape-marketplace/index.ts`** — Remove vibe_analysis fields from the Phase 3 extraction prompt and response parsing. Keep only the core property data fields.

2. **`supabase/functions/crawl-external-properties/index.ts`** — For existing/updated listings, run vibe analysis if the stored `vibe_analysis` lacks `image_analyses` (indicating it was text-based or empty), instead of unconditionally skipping.

