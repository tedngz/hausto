-- Two cron jobs have been driving scheduled-crawl every 30 minutes:
--
--   auto-crawl-v2   jobid 7,  owned by supabase_read_only_user
--   auto-crawl-v3   jobid 13, owned by postgres
--
-- 20260818140000_scheduled_crawl_cron_auth.sql closed the endpoint to the anon
-- key, because it is published in the client bundle and could not tell pg_cron
-- apart from a stranger with curl. v3 was added then; v2 was never removed. It
-- has been posting the anon key into a 401 forty-eight times a day ever since,
-- which is a lot of green-looking cron history that never did anything.
--
-- THIS MIGRATION CANNOT REMOVE IT, and the attempt is left here deliberately so
-- nobody spends the afternoon rediscovering why:
--
--   cron.unschedule(name) only touches jobs owned by the calling role, and
--   db push runs as `postgres` while the job is owned by
--   `supabase_read_only_user`. It fails with
--       ERROR: could not find valid entry for job 'auto-crawl-v2' (XX000)
--   which reads like the job is missing rather than like a permissions problem.
--   Deleting the row directly is no better: cron.job is owned by
--   supabase_admin and postgres has no DELETE on it.
--
-- So this is a dashboard job, the same way edge-function secrets are:
--   https://supabase.com/dashboard/project/gbgrwjdmytaksrztcyzs/integrations/cron
--   unschedule `auto-crawl-v2`, leave `auto-crawl-v3` alone.
--
-- Dropping v2 does not change crawl cadence - v3 is the job that actually runs.
--
-- The attempt is wrapped so a permissions failure can never redden the deploy,
-- and so this becomes a no-op the moment someone does remove it by hand.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-crawl-v2') THEN
    PERFORM cron.unschedule('auto-crawl-v2');
    RAISE NOTICE 'Unscheduled auto-crawl-v2.';
  ELSE
    RAISE NOTICE 'auto-crawl-v2 is already gone - nothing to do.';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Could not unschedule auto-crawl-v2 (%): it is owned by another role. Unschedule it from the dashboard; see the comment in this migration.', SQLERRM;
END
$$;
