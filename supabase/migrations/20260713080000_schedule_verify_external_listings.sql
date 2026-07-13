-- Schedule verify-external-listings every 20 minutes.
-- Each run archives age-capped stale listings (>60 days unconfirmed), then verifies a
-- batch of 25 listings that are due: never-verified first, then recent listings (<14 days
-- old) unchecked for 3+ days, then older listings unchecked for 7+ days.
-- Capacity: 25 listings x 72 runs/day = 1800 checks/day, self-throttled by the due filter.
SELECT cron.schedule(
  'verify-external-listings',
  '*/20 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://gbgrwjdmytaksrztcyzs.supabase.co/functions/v1/verify-external-listings',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdiZ3J3amRteXRha3NyenRjeXpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIwNDQwNDcsImV4cCI6MjA2NzYyMDA0N30.pJnXggzvzGxHrOaF_ygThG7Ws66Y4VFH102iQtPS118"}'::jsonb,
    body := '{"source": "cron"}'::jsonb
  );
  $$
);

-- Composite index so the due-filter query stays fast as the table grows
CREATE INDEX IF NOT EXISTS idx_external_properties_verify_due
ON public.external_properties (is_active, last_verified_at, crawled_at)
WHERE is_active = true;
