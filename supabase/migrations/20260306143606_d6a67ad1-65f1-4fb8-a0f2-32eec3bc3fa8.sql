-- Remove old crawl cron job
SELECT cron.unschedule('crawl-hcm-popular');

-- Create new scheduled crawl job - runs every 30 minutes
-- Each run picks the least-recently-crawled location automatically
SELECT cron.schedule(
  'auto-crawl-external-listings',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://gbgrwjdmytaksrztcyzs.supabase.co/functions/v1/scheduled-crawl',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdiZ3J3amRteXRha3NyenRjeXpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIwNDQwNDcsImV4cCI6MjA2NzYyMDA0N30.pJnXggzvzGxHrOaF_ygThG7Ws66Y4VFH102iQtPS118"}'::jsonb,
    body := '{"time": "auto"}'::jsonb
  );
  $$
);