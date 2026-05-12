## Problem

Mirrored images are being **overwritten across listings** because the storage path key truncates away the unique part of the `external_id`.

In `mirrorOne` (used by both `backfill-external-images` and `process-vibe-queue`):

```ts
const safeId = externalId.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 80);
const path = `${safeId}/${idx}.${ext}`;  // upsert: true
```

Nhatot uses **base64-encoded source URLs** as `external_id`. The shared "https://www.nhatot.com/thue-can-ho-chung-cu-quan-1-tp-ho-chi-minh/" prefix encodes to ~73 chars. After prepending `nhatot-`, truncation at 80 chars **chops off the listing ID entirely**, so every District-1 Nhatot listing writes to the same path. With `upsert: true`, the last mirror wins and earlier listings end up displaying somebody else's photos.

Confirmed: 8 District-1 Nhatot listings (including the one the user reported, `aac802b6...`) all share the exact same 80-char key.

## Fix

### 1. Make the storage key collision-proof

Replace the truncation-only scheme with a **hash-based** key that's both short and unique. In `supabase/functions/backfill-external-images/index.ts` and `supabase/functions/process-vibe-queue/index.ts`:

```ts
async function safeFolder(externalId: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(externalId));
  const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  // Keep a short readable prefix for debugging, plus 16 hex chars of hash for uniqueness
  const readable = externalId.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
  return `${readable}-${hex.substring(0, 16)}`;
}
```

Path becomes `${safeFolder}/${idx}.${ext}`. Total length stays well under storage limits and is deterministic so re-runs still upsert into the same place per listing.

### 2. Backfill / repair affected rows

The damage is already on disk. One-shot repair:

- Add a small admin action (button in `AdminTools.tsx` or a one-off SQL) that, for every row whose `images[]` points at the legacy `external-property-images/` paths, **clears `images` back to `raw_data.original_image_urls`** (when present) or to the source URLs we still have in `raw_data`, then re-runs `backfill-external-images` with the new keying.
- For rows where we no longer have the original URLs stored, mark them for re-crawl (set `vibe_status='pending'` and re-enqueue) so the next crawl repopulates from source.

If `raw_data.original_image_urls` was never persisted (the existing plan.md mentions storing it but the current `process-vibe-queue` does not), we additionally need to start saving the pre-mirror URLs into `raw_data.original_image_urls` going forward — a 2-line change in `process-vibe-queue` before the DB update.

### 3. Verification

After deploy + repair:
- Re-query the user's example listing `aac802b6-9d12-4d2d-947b-4c90685c4fd9` and confirm its `images[]` paths contain a unique hash suffix.
- Spot-check 3 of the 8 colliding listings to confirm each now resolves to its own distinct images matching its `source_url`.

## Out of scope

- No schema migration is required.
- No change to crawl scheduling, Redis, or vibe analysis logic.
