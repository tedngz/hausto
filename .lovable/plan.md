

## Root Causes

### 1. Outdoor-only listings bypass vision QC

The crawler has two parallel ingestion paths (see `mem://architecture/crawler/multi-phase-marketplace-scraping`):

- **Phase 3 (metadata-only)** — `scrape-marketplace` writes the listing to `external_properties` immediately after extracting title, price, location, and image URLs. **No vision call happens here.**
- **Phase 7 (vision QC)** — `analyze-vibe` is only invoked when (a) Phase 3 succeeds AND (b) the daily vision budget allows AND (c) the listing isn't already cached as "high quality."

When the daily OpenAI budget is exhausted or the function aborts at the 140s safety cutoff, Phase 7 is skipped but the Phase 3 row stays `is_active = true`. The `46f05279...` listing is one of these — it has only outdoor/exterior shots because nothing rejected the gallery.

There is also no rejection rule that says "if every image is exterior, deactivate." The vision QC memory mentions filtering non-apartment images but the actual prompt in `analyze-vibe` does not gate the listing on interior coverage — it scores the images that exist.

### 2. OpenAI TPM rate limits

`analyze-vibe` and `backfill-image-highlights` both call `gpt-4o-mini` with **5 base64-encoded images per request** (~1–2 MB inlined data each). During a crawl burst:

- Each property = 1 request × 5 images × ~2K vision tokens = ~10K input tokens.
- The crawler processes properties **sequentially in the same function invocation** with no inter-request delay.
- 10 listings ≈ 100K tokens in under a minute, which trips the `gpt-4o-mini` TPM ceiling on the project's tier.
- On 429 the code logs the error to `detailed_analysis` and moves on — the row is saved with `"rate_limit_exceeded"` text where the highlight should be. That's why `abf7c5a1...` and 9 others have stale error strings.

No retry, no backoff, no queue throttle, no Gemini fallback wired in for the vibe path (the memory says Gemini is the documented fallback but the code does not call it).

---

## Plan — Quality-First Fix (No Fallbacks)

### A. Block outdoor-only listings at ingestion

Modify `supabase/functions/scrape-marketplace/index.ts`:

1. Before saving a Phase 3 row, run a **lightweight interior gate**: a single `gpt-4o-mini` vision call on the first 3 images asking "does at least one image show an apartment interior (living room, bedroom, kitchen, bathroom)? Return JSON `{has_interior: bool, interior_indices: number[]}`."
2. If `has_interior === false` → **do not insert the listing**. Log to a new `crawler_rejections` table (id, source_url, reason, sample_images, rejected_at) for admin visibility.
3. If `has_interior === true` → keep only `interior_indices` images in the gallery, drop pure exterior shots before saving.

This guarantees every listing entering `external_properties` has interior coverage. One extra vision call per listing, but it replaces wasted Phase 7 work on bad galleries.

### B. Eliminate TPM rate limits with proper throttling

Modify `supabase/functions/analyze-vibe/index.ts` and `supabase/functions/backfill-image-highlights/index.ts`:

1. **Per-image requests instead of batch-of-5**: switch from "5 images in one prompt" to "1 image per request." Smaller payloads = lower TPM spike, better per-image specificity, and a single failure no longer poisons 5 highlights.
2. **Token-budget-aware concurrency limiter**: add a Redis-backed sliding-window counter (`vibe:tpm:<minute>`) using existing Upstash infra. Before each call, check the current minute's token spend; if it would exceed 80% of the project's TPM cap, sleep until the next window.
3. **Exponential backoff with jitter on 429**: 1s → 2s → 4s → 8s with ±20% jitter, max 3 retries. After 3 failures, the property stays in a `pending_vibe` state (new column `vibe_status text default 'pending'`) — never written as a fake highlight.
4. **Strict status enum**: `vibe_status` ∈ `pending | processing | complete | rejected_no_interior`. The admin "✓ vibe" badge keys off `vibe_status = 'complete'`, removing all the heuristic string-checking added in earlier iterations.

### C. Async background processing

Move vibe analysis out of the synchronous crawl path:

1. After scrape-marketplace saves a clean listing, push a job to a new `vibe_analysis_queue` table (`property_id`, `enqueued_at`, `attempts`).
2. New scheduled function `process-vibe-queue` runs every 2 minutes via QStash, pulls up to N jobs (where N respects the TPM budget from step B2), processes them, marks `vibe_status = complete`.
3. Listings remain `is_active = false` until `vibe_status = complete`. They become discoverable only after they pass full vision QC.

### D. Backfill the existing damage

One-time script (run from the Backfill admin tool):

1. Find all `external_properties` with `vibe_status` missing or with `rate_limit_exceeded` strings in `detailed_analysis`.
2. Reset them to `vibe_status = 'pending'`, `is_active = false`.
3. Run the interior gate (step A) — deactivate ones that fail.
4. Enqueue survivors into the vibe queue (step C).

---

## Technical Details

**New DB migrations:**
- `external_properties.vibe_status text default 'pending' check (vibe_status in ('pending','processing','complete','rejected_no_interior'))`
- New table `crawler_rejections (id, source_url, source, reason, sample_images jsonb, rejected_at)`
- New table `vibe_analysis_queue (id, property_id, enqueued_at, attempts int default 0, last_error text, status text default 'queued')`
- RLS: admin-only on both new tables via `has_role(auth.uid(), 'admin')`

**Edge function changes:**
- `scrape-marketplace`: add `interiorGate()` call before insert
- `analyze-vibe`: refactor to per-image, add Redis TPM limiter, add backoff
- `backfill-image-highlights`: same refactor; remove "rate_limit_exceeded" tolerance — fail loudly to queue
- New `process-vibe-queue`: scheduled consumer
- `supabase/config.toml`: add `[functions.process-vibe-queue] verify_jwt = false`

**Admin UI updates (`src/pages/AdminTools.tsx`):**
- Replace badge heuristic with `vibe_status === 'complete'` check
- Add a "Rejections" tab showing `crawler_rejections` (so you can see *why* a URL was skipped — outdoor-only, no images, etc.)
- Add a "Vibe Queue" widget showing queue depth and TPM headroom

**Removed code:**
- `GENERIC_HIGHLIGHTS` array and string-matching validation in AdminTools (replaced by enum)
- All `rate_limit_exceeded` swallow paths — these become hard failures that requeue

---

## Outcome

- **No outdoor-only listings** ever reach the discovery feed (interior gate at ingestion).
- **Zero rate-limit poisoning** — TPM limiter prevents 429s; the rare 429 retries with backoff; persistent failures stay queued, never fake-completed.
- **No fallbacks**: every published listing has real GPT-4o-mini per-image highlights or it isn't published.
- Admin gets clear visibility into rejections and queue health.

