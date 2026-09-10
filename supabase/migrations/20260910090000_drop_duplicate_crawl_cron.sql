-- Two cron jobs have been driving scheduled-crawl every 30 minutes:
--
--   auto-crawl-v2   Authorization: Bearer <anon key>
--   auto-crawl-v3   x-cron-secret: <vault secret>
--
-- 20260818140000_scheduled_crawl_cron_auth.sql closed the endpoint to the anon
-- key, because it is published in the client bundle and could not tell pg_cron
-- apart from a stranger with curl. v3 was added then; v2 was never removed. It
-- has been posting the anon key into a 401 forty-eight times a day ever since,
-- which is a lot of green-looking cron history that never did anything.
--
-- v3 is the live one. Dropping v2 does not change crawl cadence.
SELECT cron.unschedule('auto-crawl-v2')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-crawl-v2');
