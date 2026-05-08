## Goal

Use remaining Firecrawl credits now to crawl as many marketplace listings as possible (Nhatot, Batdongsan) and store the raw data in `external_properties` **without spending any OpenAI credits**. Listings stay hidden from users until you later run vibe analysis on them.

## How it works

A new admin-only "Raw Crawl" button kicks off a self-chaining crawl loop that:
1. Uses Firecrawl to scrape marketplace listing URLs and detail pages.
2. Saves listings as `is_active = false` with `vibe_status = 'pending'` so they don't appear in Discover, search, or sharing — but the raw data, images, contact info, and source URL are all persisted.
3. Skips every OpenAI/Lovable AI call: no GPT-4o-mini vision interior gate, no AI-generated description, no vibe analysis, no image-highlights backfill.
4. Self-chains via QStash to keep crawling district after district until either Firecrawl returns insufficient credits or all locations have been crawled in this session.

When you're ready to spend OpenAI credits later, the existing `backfill-image-highlights` and vibe-queue processors will pick these up because they're already enqueued in `vibe_analysis_queue`. Activating a listing happens automatically once vibe analysis succeeds.

## Changes

### Database migration
- Add column `external_properties.raw_only` (boolean, default false) — marks rows captured in raw mode, used by vibe processors and admin tools.
- Add an admin SELECT path that already exists; no new RLS needed because `is_active = false` already hides rows from `anon` and `authenticated`. Admins keep full access via existing policy.
- Optional index on `(is_active, vibe_status, raw_only)` to speed up backfill queries.

### `scrape-marketplace` edge function
- Add `rawMode: boolean` to the request body. When true:
  - Skip `selectInteriorImages()` (the GPT-4o-mini vision gate). Use URL-based filtering only (`isValidPropertyImageUrl`).
  - Skip the AI description/vibe-text generation (`callAI` paths around lines 840, 1123, 1212). Use scraped title/description as-is.
  - Save with `is_active: false`, `vibe_status: 'pending'`, `raw_only: true`.
  - Still enqueue into `vibe_analysis_queue` so future processing finds them.
  - Still extract phone numbers (Browserless / Nhatot public API) since that doesn't cost OpenAI.
- Detect Firecrawl 402/insufficient-credits responses and return `{ outOfCredits: true }` so the caller can stop chaining.

### `scheduled-crawl` edge function
- Accept `mode: 'raw'` payload (manual trigger only — does not affect the cron loop).
- In raw mode:
  - Bypass the `MAX_DAILY_LISTINGS = 10` cap.
  - Bypass the 48h location cooldown so it can sweep districts quickly.
  - Pass `rawMode: true, includeVibeAnalysis: false, directSave: true` to `scrape-marketplace` and use a higher `maxResults` (e.g. 30 per call).
  - Skip the inline `runVibeAnalysis` block, the `backfill-vibe` QStash chain, and the `backfill-image-highlights` call.
  - Self-chain via QStash to the next location until `outOfCredits` is hit or no eligible locations remain.

### Admin UI (`src/pages/AdminTools.tsx`)
- New section "Raw Marketplace Harvest" with:
  - One-shot button **Start raw crawl** (calls `scheduled-crawl` with `{ mode: 'raw' }`).
  - Live counter showing total `raw_only = true` listings stored, plus a count of those still `vibe_status = 'pending'`.
  - Small note: "These listings are hidden from users until vibe analysis is run."
- Add a separate **Process raw queue** button (later use) that triggers the existing `process-vibe-queue` / `backfill-image-highlights` pipeline against `raw_only = true` rows — so converting raw data into live listings is a deliberate, one-click action when you're ready to spend OpenAI credits.

## Out of scope
- No changes to the cron schedule. The hourly cron keeps running normal AI-powered crawls within the 10/day cap.
- No frontend changes for end-users. Discover, search, sharing, and the public agent API continue to filter by `is_active = true`, so raw rows stay invisible.
- No changes to currency formatting, security policies, or other unrelated systems.

## Technical details

- `raw_only` is the single source of truth for "this came in without AI processing". When the future processing run flips `vibe_status` to `'completed'` and `is_active` to `true`, you can either keep `raw_only = true` for analytics or clear it — easy follow-up.
- Firecrawl insufficient-credits detection: check `response.status === 402` or response body containing `"insufficient_credits"` inside `firecrawlFetch`. Surface as a thrown error type the caller catches.
- QStash self-chaining already exists in `scheduled-crawl`; the raw mode just keeps the `mode: 'raw'` flag in the chained payload.
- Phone extraction (Browserless) is kept on; if you also want to skip it to save Browserless credits, that's a one-line toggle we can add.
