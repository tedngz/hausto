-- Finished jobs are deleted after 30 days.
--
-- `jobs` is a queue, not a record. What happened lives in the event logs
-- (`events`, `inquiry_events`) and in `messages`; a finished job row only
-- says the runner got to it. Nothing reads one older than 21 days - the drain
-- looks back that far for refusals it holds on, and 20 hours for viewing-day
-- jobs - so 30 days leaves margin. The holding-update pile-up of September
-- 2026 left 974 of them for one request; this clears those by November and
-- keeps the table from growing again.
--
-- Unfinished jobs (completed_at IS NULL) are never touched: they are either
-- the runner's work or a person's to-do.
--
-- 03:50 in Ho Chi Minh City, clear of the other nightly jobs. Replay-safe:
-- cron.schedule replaces a job of the same name.

DO $$
BEGIN
  PERFORM cron.schedule(
    'jobs-retention',
    '50 20 * * *',
    $cmd$
  DELETE FROM public.jobs
   WHERE completed_at IS NOT NULL
     AND completed_at < now() - interval '30 days';
  $cmd$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'jobs-retention not scheduled: %', SQLERRM;
END $$;
