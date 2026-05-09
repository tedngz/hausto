## Problem

Crawled `external_properties.images` are remote URLs (Nhatot/Batdongsan CDNs). When the source listing is removed, the images 404 — so the listing card on Hausto becomes a broken-image gallery, even though the row still exists.

## Storage capacity check

Current Supabase storage usage:

| Bucket | Objects | Size |
|---|---|---|
| property-images (manual realtor uploads) | 1,228 | 174 MB |
| avatars | 8 | 4 MB |
| **Total** | | **~178 MB** |

External crawled inventory:

- 700 external_properties rows total (31 active processed, 161 raw-harvested)
- 4,272 image URLs across all rows; 149 on currently-active processed listings

Estimated cost to mirror everything (avg ~145 KB/image based on existing bucket):

- All 4,272 images ≈ **~620 MB** → would push us to ~800 MB total
- Active processed only (149 images) ≈ **~22 MB** → trivial
- Active processed + raw harvested (~1,500 images) ≈ **~220 MB** → safe

Free Supabase tier is 1 GB. We have headroom for the active set, but mirroring every raw-harvested image plus ongoing daily crawls (10/day × ~5 imgs × 145 KB ≈ 7 MB/day, ~210 MB/month) will exhaust free tier in ~4 months. Pro tier is 100 GB, so this is only a concern if you stay on free.

## Plan

### 1. New storage bucket `external-property-images`

Public bucket, separate from `property-images` so we can prune independently. Path convention: `{external_id}/{index}-{hash}.jpg`.

### 2. Image-mirroring helper (shared utility)

Add `supabase/functions/_shared/mirror-images.ts` with `mirrorImagesToStorage(urls, externalId, supabase)`:

- Fetch each URL with timeout + size cap (e.g. 2 MB/image, reject > 5 MB)
- Re-encode/normalize to JPEG (skip if already small jpeg)
- Upload to bucket with deterministic path; skip if object already exists
- Return new public storage URLs in same order; on per-image failure, fall back to original URL so we never break the gallery

### 3. Wire mirroring into the crawl pipeline

In `scrape-marketplace/index.ts` `savePropertiesToDB`, after vision QC selects the final image set and just before insert/update:

- Mirror selected images
- Store the storage URLs in `images[]`
- Keep original URLs in `raw_data.original_image_urls` for debugging/reverification

Apply to both raw-harvest and full-process paths (raw harvest also benefits since those listings disappear fastest).

### 4. Backfill for existing rows

New admin edge function `backfill-external-images`:

- Scan active external_properties whose `images[]` still contain non-Supabase URLs
- Run mirroring in small batches (10 rows) to stay under 150s
- Add a button in `AdminTools.tsx` next to existing crawler controls

### 5. Lifecycle / cleanup

When `external_properties.is_active = false` for >30 days OR row deleted, delete the corresponding folder from storage. Add to existing `cleanup_expired_external_properties` flow (DB function calls a small edge function for storage delete, or run in `scheduled-crawl`).

### 6. RLS / bucket policy

Public read (same as `property-images`). Insert/update/delete restricted to service role (edge functions only).

## Recommendation on scope

Given free-tier headroom, suggest mirroring **only listings that pass vision QC** (i.e. when `vibe_status = 'complete'` / leaving raw set, or always for processed crawls). Skip mirroring during raw-harvest itself — those rows are throwaway candidates, and only ~5% become real listings. This keeps storage growth proportional to inventory the renters actually see.

## Open question

Do you want raw-harvested images mirrored too (safer but uses ~4× more storage), or only when a listing graduates to processed/active?
