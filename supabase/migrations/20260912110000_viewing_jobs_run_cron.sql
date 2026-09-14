-- The other half of the timer: running what the drain enqueued.
--
-- Offset from the drain by five minutes rather than sharing its slot. They
-- touch the same rows and the drain's dedupe check reads `jobs` while the
-- runner writes it - overlapping them buys nothing and makes a lock wait
-- possible for no reason.
--
-- Every 15 minutes, like the drain. The deadline being protected is 24 hours
-- and the scheduler acts at 20, so worst case a holding update goes out 20h15m
-- after the renter last heard anything. That is three and three quarter hours
-- of margin on a promise measured in days.

SELECT cron.unschedule('viewing-jobs-run')
WHERE EXISTS (
  SELECT 1 FROM cron.job
  WHERE jobname = 'viewing-jobs-run' AND username = current_user
);

SELECT cron.schedule(
  'viewing-jobs-run',
  '5,20,35,50 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://gbgrwjdmytaksrztcyzs.supabase.co/functions/v1/viewing-jobs-run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
