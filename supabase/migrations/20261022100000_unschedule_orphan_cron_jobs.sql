-- Two cron jobs that 20260910090000_drop_duplicate_crawl_cron.sql could not
-- remove, because they were owned by supabase_read_only_user:
--
--   auto-crawl-v2                   jobid 7, posts to scheduled-crawl with the
--                                   anon key; auto-crawl-v3 (jobid 13) replaced it
--   deactivate-expired-properties   jobid 5, duplicated by
--                                   deactivate-expired-properties-v2 (jobid 16)
--
-- Both failed every run on "permission denied" until 2026-10-17 16:00 UTC, when
-- their owner became `postgres` (the support ticket filed 2026-09-28). Since then
-- they succeed: v2 reaches scheduled-crawl and is turned away 48 times a day
-- ("Rejected unauthorized request" - the anon key is not a credential there),
-- and jobid 5 runs the same sweep as jobid 16 at the same minute.
--
-- Owned by postgres, they can now be unscheduled by the role db push runs as.
-- Matched on jobid, name and owner together, so a job that has since been
-- recreated under another id is left alone; wrapped so that a permissions
-- failure warns rather than aborting the migrations queued behind this one.
DO $$
DECLARE
  j record;
BEGIN
  FOR j IN
    SELECT jobid, jobname FROM cron.job
     WHERE (jobid, jobname) IN ((7, 'auto-crawl-v2'), (5, 'deactivate-expired-properties'))
       AND username = current_user
  LOOP
    PERFORM cron.unschedule(j.jobid);
    RAISE NOTICE 'Unscheduled % (jobid %).', j.jobname, j.jobid;
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Could not unschedule the orphan cron jobs (%). Check owners with: SELECT jobid, jobname, username FROM cron.job;', SQLERRM;
END
$$;
