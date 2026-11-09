-- Storage garbage collection (free plan: 1 GB; 0.86 GB used on 2026-11-09).
--
-- Nothing deleted a listing's photos when it died, and a mirroring run killed
-- between uploading photos and recording them on the row (process-vibe-queue,
-- the 546s of 2026-11-03) left them with nothing pointing at them. On
-- 2026-11-09 that was 181 MB of photos of listings dead for 30+ days, 71 MB of
-- unreferenced listing photos and 66 MB of unreferenced property-images.
--
-- Two steps, run daily by the storage-gc function, which does the deleting
-- (storage objects are removed through the Storage API, never from SQL):
--
--   1. storage_gc_release_dead_listings: a listing inactive for 30+ days, and
--      on no viewing request, gets its source's own image URLs back
--      (raw_data.original_image_urls) in place of our copies. A dead nhatot ad
--      that is reposted takes fresh URLs from the ad anyway
--      (verify-external-listings, resurrectNhatotAds).
--   2. storage_gc_orphans: files nothing points to - no listing, property,
--      building, avatar or chat message - past a grace period, so a mirror
--      run still between upload and row write is never touched.
--
-- Releasing before deleting means a failed delete leaves an orphan the next
-- run retries, never a listing pointing at a missing file.

-- Every storage URL the app stores, by bucket and path. chat_messages carry
-- listing cards with photo URLs; complexes have a hero image and a gallery.
CREATE OR REPLACE FUNCTION public.storage_gc_references()
RETURNS TABLE (bucket text, path text)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH texts AS (
    SELECT u AS t FROM external_properties, unnest(images) u
    UNION ALL SELECT u FROM properties, unnest(images) u
    UNION ALL SELECT hero_image FROM complexes
    UNION ALL SELECT gallery::text FROM complexes
    UNION ALL SELECT avatar_url FROM profiles
    UNION ALL SELECT content::text FROM chat_messages
  )
  SELECT DISTINCT m[1], m[2]
  FROM texts, regexp_matches(t, '/storage/v1/object/public/([a-z0-9_-]+)/([^"''\s\)\]\\?,}]+)', 'g') m
  WHERE t LIKE '%/storage/v1/object/public/%'
$$;

-- Step 1. Returns how many listings were released.
CREATE OR REPLACE FUNCTION public.storage_gc_release_dead_listings(
  _dead_days integer DEFAULT 30,
  _limit integer DEFAULT 500
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  WITH due AS (
    SELECT p.id
      FROM external_properties p
     WHERE NOT p.is_active
       AND p.deactivated_at < now() - make_interval(days => greatest(_dead_days, 7))
       AND NOT EXISTS (SELECT 1 FROM request_items r WHERE r.listing_id = p.id)
       AND EXISTS (SELECT 1 FROM unnest(p.images) u
                    WHERE u LIKE '%/storage/v1/object/public/external-property-images/%')
     ORDER BY p.deactivated_at
     LIMIT greatest(_limit, 0)
  )
  UPDATE external_properties p
     SET images = coalesce(
           (SELECT array_agg(o ORDER BY i)
              FROM jsonb_array_elements_text(
                     CASE WHEN jsonb_typeof(p.raw_data->'original_image_urls') = 'array'
                          THEN p.raw_data->'original_image_urls' ELSE '[]'::jsonb END
                   ) WITH ORDINALITY AS x(o, i)
             WHERE o NOT LIKE '%/storage/v1/object/public/%'),
           '{}'::text[]),
         raw_data = coalesce(p.raw_data, '{}'::jsonb)
                    || jsonb_build_object('photos_released_at', now())
    FROM due
   WHERE p.id = due.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Step 2. Unreferenced files past their grace period, oldest first. The grace
-- runs from the later of upload and overwrite: a re-mirror upserts the same
-- paths, keeping the original created_at.
CREATE OR REPLACE FUNCTION public.storage_gc_orphans(
  _limit integer DEFAULT 500,
  _listing_grace_days integer DEFAULT 2,
  _property_grace_days integer DEFAULT 30
)
RETURNS TABLE (bucket text, path text, bytes bigint)
LANGUAGE sql STABLE
SET search_path = public, storage
AS $$
  WITH refs AS (SELECT * FROM public.storage_gc_references())
  SELECT o.bucket_id, o.name, coalesce((o.metadata->>'size')::bigint, 0)
    FROM storage.objects o
   WHERE o.bucket_id IN ('external-property-images', 'property-images')
     -- Agents' photos from Zalo, kept with their inquiry (_shared/realtor/bridge.ts).
     AND o.name NOT LIKE 'concierge/%'
     AND o.name NOT LIKE '%.emptyFolderPlaceholder'
     AND greatest(o.created_at, coalesce(o.updated_at, o.created_at)) < now() - make_interval(days =>
           CASE WHEN o.bucket_id = 'property-images' THEN greatest(_property_grace_days, 7)
                ELSE greatest(_listing_grace_days, 1) END)
     AND NOT EXISTS (SELECT 1 FROM refs r WHERE r.bucket = o.bucket_id AND r.path = o.name)
   ORDER BY o.created_at
   LIMIT greatest(_limit, 0)
$$;

REVOKE ALL ON FUNCTION public.storage_gc_references() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.storage_gc_release_dead_listings(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.storage_gc_orphans(integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storage_gc_references() TO service_role;
GRANT EXECUTE ON FUNCTION public.storage_gc_release_dead_listings(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.storage_gc_orphans(integer, integer, integer) TO service_role;

-- Daily at 03:13 Ho Chi Minh City, away from the crawl's busy hours.
DO $$
BEGIN
  PERFORM cron.schedule(
    'storage-gc',
    '13 20 * * *',
    $cmd$
  SELECT net.http_post(
    url := 'https://gbgrwjdmytaksrztcyzs.supabase.co/functions/v1/storage-gc',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cmd$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'storage-gc cron not scheduled: %', SQLERRM;
END $$;
