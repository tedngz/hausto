-- Keep Meta's template status fresh.
--
-- Hourly. Templates change rarely - an approval, a rejection on resubmission, a
-- quality pause - so this is not about latency; it is about the state never
-- going stale for days without anyone looking. One Graph API call an hour is
-- free in every sense that matters.
--
-- The function no-ops and returns 200 until WHATSAPP_WABA_ID and
-- WHATSAPP_ACCESS_TOKEN exist, which is the normal state until the WABA is
-- provisioned. Scheduling it now rather than later means the day those secrets
-- are set, the reconciliation starts on its own rather than waiting for
-- somebody to remember this migration.
--
-- Minute 40 to sit clear of the viewing job crons at :00/:15/:30/:45 and
-- :05/:20/:35/:50.

SELECT cron.unschedule('whatsapp-template-sync')
WHERE EXISTS (
  SELECT 1 FROM cron.job
  WHERE jobname = 'whatsapp-template-sync' AND username = current_user
);

SELECT cron.schedule(
  'whatsapp-template-sync',
  '40 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://gbgrwjdmytaksrztcyzs.supabase.co/functions/v1/whatsapp-template-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
