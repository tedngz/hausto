-- Perceptual image hashes for duplicate-unit detection: agents repost the
-- landlord's photo set, so shared image fingerprints identify the same unit
-- even when titles, prices, or project names differ.

ALTER TABLE public.external_properties
ADD COLUMN IF NOT EXISTS image_hashes TEXT[] DEFAULT NULL,
-- Same images but materially different claimed location: bait or stolen
-- photos. Flagged for ops review, never auto-merged.
ADD COLUMN IF NOT EXISTS image_location_conflict BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_external_properties_image_hashes
ON public.external_properties USING GIN (image_hashes)
WHERE image_hashes IS NOT NULL;

-- Hash new/unhashed listings every 30 minutes (self-throttling: exits early
-- when nothing is unhashed)
SELECT cron.schedule(
  'hash-listing-images',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://gbgrwjdmytaksrztcyzs.supabase.co/functions/v1/hash-listing-images',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdiZ3J3amRteXRha3NyenRjeXpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIwNDQwNDcsImV4cCI6MjA2NzYyMDA0N30.pJnXggzvzGxHrOaF_ygThG7Ws66Y4VFH102iQtPS118"}'::jsonb,
    body := '{"source": "cron"}'::jsonb
  );
  $$
);
