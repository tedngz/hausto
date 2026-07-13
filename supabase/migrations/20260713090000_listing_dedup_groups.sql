-- Deduplication: the same physical unit is often posted by many agents at
-- different prices. Listings are clustered into groups; public surfaces show
-- one canonical card per group ("listed by N agents, price range X–Y").

ALTER TABLE public.external_properties
ADD COLUMN IF NOT EXISTS canonical_group_id UUID;

CREATE INDEX IF NOT EXISTS idx_external_properties_canonical_group
ON public.external_properties (canonical_group_id)
WHERE canonical_group_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.listing_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_key TEXT NOT NULL,
  city TEXT,
  rooms TEXT,
  size_sqm NUMERIC,
  price_min NUMERIC,
  price_max NUMERIC,
  member_count INTEGER NOT NULL DEFAULT 1,
  representative_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listing_groups_project
ON public.listing_groups (project_key, city, rooms);

ALTER TABLE public.listing_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view listing groups" ON public.listing_groups
  FOR SELECT USING (true);

-- Nightly dedupe at 19:10 UTC (02:10 ICT), off-peak
SELECT cron.schedule(
  'dedupe-external-listings',
  '10 19 * * *',
  $$
  SELECT net.http_post(
    url := 'https://gbgrwjdmytaksrztcyzs.supabase.co/functions/v1/dedupe-external-listings',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdiZ3J3amRteXRha3NyenRjeXpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIwNDQwNDcsImV4cCI6MjA2NzYyMDA0N30.pJnXggzvzGxHrOaF_ygThG7Ws66Y4VFH102iQtPS118"}'::jsonb,
    body := '{"source": "cron"}'::jsonb
  );
  $$
);
