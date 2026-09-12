-- S6: the timer behind the 24-hour promise.
--
-- `viewing-jobs-drain` scans open requests and enqueues whatever each one is
-- owed - a holding update to a renter who has heard nothing, a nudge to a
-- broker who has gone quiet, a reminder for tomorrow's viewing. The decision
-- itself is pure and lives in `_shared/viewing/reminders.ts`; this only makes
-- it run.
--
-- Every 15 minutes. The deadline it protects is 24 hours and the scheduler
-- acts at 20, so the margin is four hours - a quarter-hour scan is far finer
-- than it needs to be, and cheap enough at ~25 requests a day that the
-- alternative (tuning it) would cost more than running it.
--
-- Authenticates with `cron_secret`, the same way auto-crawl-v3 and
-- extract-phone-hourly do. The vault holds no service-role key, and the anon
-- key is published in the client bundle so it proves nothing about the caller.

-- Unschedule only what this role owns. `cron.unschedule(name)` matches on the
-- calling role, and against a job owned by anyone else it fails with a message
-- that reads like the job does not exist - which aborts the push and silently
-- strands every migration queued behind it (see CLAUDE.md).
SELECT cron.unschedule('viewing-jobs-drain')
WHERE EXISTS (
  SELECT 1 FROM cron.job
  WHERE jobname = 'viewing-jobs-drain' AND username = current_user
);

SELECT cron.schedule(
  'viewing-jobs-drain',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://gbgrwjdmytaksrztcyzs.supabase.co/functions/v1/viewing-jobs-drain',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- The drain reads this on every pass to avoid enqueueing a job it already
-- enqueued. Without it that check is a sequential scan every 15 minutes.
CREATE INDEX IF NOT EXISTS jobs_open_by_kind_idx
  ON public.jobs (kind)
  WHERE completed_at IS NULL;
