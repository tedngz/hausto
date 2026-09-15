-- The weekly digest sweep.
--
-- Tuesday 02:00 UTC = Tuesday 09:00 in Ho Chi Minh City. Deliberate: a message
-- that arrives mid-morning on a weekday is one somebody reads, and one that
-- arrives at 3am is one they wake up to and opt out of.
--
-- Not Monday, because Monday morning is the busiest inbox of the week and this
-- is the least urgent thing we send.
--
-- `send` is NOT passed, so the scheduled run is a DRY RUN: it counts who would
-- have been messaged and sends nothing. That is the right default until
-- `weekly_digest` is approved by Meta and somebody has looked at the number.
-- Flipping it to a real send is a deliberate edit to this migration, which is
-- exactly the amount of friction recurring outbound marketing deserves.

SELECT cron.unschedule('viewing-digest-weekly')
WHERE EXISTS (
  SELECT 1 FROM cron.job
  WHERE jobname = 'viewing-digest-weekly' AND username = current_user
);

SELECT cron.schedule(
  'viewing-digest-weekly',
  '0 2 * * 2',
  $$
  SELECT net.http_post(
    url := 'https://gbgrwjdmytaksrztcyzs.supabase.co/functions/v1/viewing-digest-send',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
