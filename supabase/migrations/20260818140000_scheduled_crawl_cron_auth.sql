-- scheduled-crawl accepted any caller. Its auth chain ended in
-- `isAuthorized = true` with the comment "open access for pg_cron
-- compatibility", because the cron job authenticates with the anon key - which
-- ships in the client bundle and so cannot distinguish pg_cron from the rest of
-- the internet. A single unauthenticated POST starts a full crawl: marketplace
-- scraping plus inline vibe analysis, so it is real OpenAI spend per call.
--
-- Rather than hand pg_cron the service-role key (full DB and storage access
-- sitting in cron.job in plaintext, and a value that has to travel through
-- somebody's terminal to get there), the job gets a dedicated shared secret:
--   - generated inside Postgres, so the plaintext never leaves the database
--   - stored in Vault, not in this file and not in cron.job
--   - useless for anything except triggering a crawl
--
-- The edge function verifies it through verify_cron_secret() below, using the
-- service-role client it already builds. Rollback is cron.alter_job back to the
-- previous anon-key header.

-- 1. The secret. Created only if absent so re-running this migration does not
-- rotate it out from under a scheduled job.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'cron_secret') THEN
    PERFORM vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'cron_secret',
      'Shared secret pg_cron sends to edge functions in the x-cron-secret header'
    );
  END IF;
END $$;

-- 2. Verification for the edge function. SECURITY DEFINER because
-- vault.decrypted_secrets is not readable by the API roles, and it must stay
-- that way - this returns a boolean and never the secret itself.
CREATE OR REPLACE FUNCTION public.verify_cron_secret(_token text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name = 'cron_secret'
      AND _token IS NOT NULL
      AND length(_token) > 0
      AND s.decrypted_secret = _token
  );
$$;

-- Only the service role may ask. anon/authenticated calling this would be an
-- oracle for guessing the secret one attempt at a time.
REVOKE ALL ON FUNCTION public.verify_cron_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_cron_secret(text) TO service_role;

-- 3. The crawl job, sending the new header. The secret is read from Vault at
-- fire time, so it appears in cron.job only as a subquery.
--
-- This is a NEW job rather than an edit of the old auto-crawl-v2 (jobid 7).
-- That job is owned by supabase_read_only_user, and postgres - the role every
-- migration here runs as - can neither alter_job nor unschedule it, nor even
-- UPDATE cron.job directly:
--
--   ERROR: Job 7 does not exist or you don't own it
--   ERROR: permission denied for table job
--
-- auto-crawl-v2 still fires every 30 minutes carrying the anon key, and the
-- function now answers it with 401, so it is inert rather than dangerous. It
-- should still be deleted by whoever can act as its owner (the dashboard's Cron
-- UI, or Supabase support) - until then it is just noise in the logs.
SELECT cron.schedule(
  'auto-crawl-v3',
  '*/30 * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://gbgrwjdmytaksrztcyzs.supabase.co/functions/v1/scheduled-crawl',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{"time": "auto"}'::jsonb
  );
  $job$
);
