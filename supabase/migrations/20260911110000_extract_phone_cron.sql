-- extract-phone has never completed a run. `phone_extraction_attempts` is 0 on
-- every one of the 696 rows, because it was only ever invoked from
-- scrape-marketplace immediately after a crawl saved NEW listings - and new
-- listings have been near zero for months. Nothing retried, and nothing noticed.
--
-- It now runs on its own schedule over whatever still lacks a dialable number,
-- rather than depending on a crawl having just succeeded.
--
-- Hourly, and the function caps itself at 10 listings per call with a 2s gap
-- between them. That is a deliberate trickle: each listing may cost a
-- Browserless reveal, which is the expensive part of this milestone.
--
-- Authenticates with `cron_secret`, the same way auto-crawl-v3 does. The vault
-- holds no service-role key, and the anon key is published in the client bundle
-- so it proves nothing about the caller.

-- The edge function calls this over RPC so "a real Vietnamese number" is defined
-- in exactly one place - shared by ingest, by the S2 backfill and by extraction,
-- which is what stops realtors.phone_e164 drifting between them.
GRANT EXECUTE ON FUNCTION public.normalize_vn_phone(text) TO service_role;

SELECT cron.unschedule('extract-phone-hourly')
WHERE EXISTS (
  SELECT 1 FROM cron.job
  WHERE jobname = 'extract-phone-hourly' AND username = current_user
);

SELECT cron.schedule(
  'extract-phone-hourly',
  '25 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://gbgrwjdmytaksrztcyzs.supabase.co/functions/v1/extract-phone',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{"autoFill": true, "limit": 10}'::jsonb
  );
  $$
);
