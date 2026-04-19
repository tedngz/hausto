
Yes — we can build a scheduled job that pings each external listing's source URL and deactivates the ones that no longer exist.

# Plan: Auto-verify external listings against source sites

## What it does
A background job runs on a schedule, checks each active external listing's source URL, and deactivates listings whose source page is gone or marked expired. Healthy listings get a refreshed `last_verified_at` timestamp.

## How verification works per source
- **Nhatot**: 404 or redirect to `/tin-dang-het-han`, or HTML contains "tin đăng đã bị gỡ" / "không tồn tại" → dead.
- **Batdongsan**: often returns 200 with a notice page → must check HTML for "Tin không tồn tại", "đã bị xóa", or "hết hạn". Needs Browserless (Cloudflare-protected, already configured).
- **Airbnb**: 404 / 410, or "Listing unavailable" / "We can't find" in body → dead.
- Network errors / 5xx / timeouts → do NOT deactivate (transient). Logged and retried next run.
- **Safety rule**: require 2 consecutive failed checks before flipping `is_active = false`, so a temporary site glitch doesn't wipe valid listings.

## New pieces

1. **Edge function `verify-external-listings`** (`verify_jwt = false`)
   - Pulls up to 50 active listings ordered by oldest `last_verified_at`
   - Fetches each source URL with 10s timeout + source-specific dead detector
   - Increments `verification_failures` on dead detection, resets on success
   - At 2 failures → `is_active = false` + invalidates `property-discovery-cache`
   - Batch capped at 50/run to stay under the 150s edge limit

2. **Schema migration on `external_properties`**
   - Add `verification_failures INTEGER DEFAULT 0`
   - Add `last_verification_status TEXT` ('alive' | 'dead' | 'error') for admin visibility
   - `last_verified_at` column already exists — will start being used

3. **pg_cron schedule** — every 6 hours (covers ~200 listings/day comfortably). Inserted via Supabase SQL Editor per project rule.

4. **Admin Tools UI** (`src/pages/AdminTools.tsx`)
   - "Verify external listings now" button for manual runs
   - Show `last_verified_at`, `last_verification_status`, and failure count next to each listing

## Files to change
- `supabase/migrations/<new>` — 2 new columns on `external_properties`
- `supabase/functions/verify-external-listings/index.ts` — new function
- `src/pages/AdminTools.tsx` — manual trigger + status display
- pg_cron SQL — provided to you to paste in SQL Editor after deploy

## Quick decisions to confirm before I build

- **Frequency**: every 6 hours (recommended), once daily, or every 2 hours?
- **Strictness**: require 2 consecutive failures (recommended), or deactivate on first detection?
- **Sources**: all three (Nhatot + Batdongsan + Airbnb), or skip Batdongsan to avoid the Browserless cost per check?

Reply with your picks (e.g. "6h, 2 failures, all three") and I'll implement it.
