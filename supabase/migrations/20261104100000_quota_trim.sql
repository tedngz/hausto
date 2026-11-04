-- Free-plan quota: the project went over egress (5.82/5 GB) and log ingestion
-- (2.49/1 GB) and was restricted on 2026-11-03 at 22:40 UTC. Almost none of it
-- was people: background jobs reading the same rows and finding nothing to do.
-- This file is the database half of the fix.
--
-- 1. Two candidate functions, so the vibe backfills download only the listings
--    that need work. Each used to read `vibe_analysis` for 200 or for every
--    listing (2.4 MB and ~9 MB a call, ~85% of it `image_analyses`) and
--    filter in the function, dozens of times a day.
-- 2. Two crons that start only when there is something to do.
-- 3. price-crosscheck every 3 hours instead of every 30 minutes.
-- 4. The duplicate daily verify-external-listings job removed.
--
-- Replay-safe: CREATE OR REPLACE, cron.schedule upserts by name, and each cron
-- change is guarded so a job owned by another role does not abort the push
-- (CLAUDE.md, "A migration cannot touch a cron job owned by another role").

-- ── 1a. scheduled-crawl's backfill-vibe ─────────────────────────────────────
-- The same test as `needsVibeBackfill` in scheduled-crawl/index.ts, which
-- still judges every row this returns: a listing among the newest `_scan`
-- active ones with images needs a pass when its analysis lacks styles,
-- colors, activities or per-image analyses, when it has no highlight that is
-- not a placeholder, or when no photo after the cover carries one.
CREATE OR REPLACE FUNCTION public.vibe_backfill_candidates(_scan integer DEFAULT 200)
RETURNS SETOF uuid
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH recent AS (
    SELECT id, created_at, highlights, vibe_analysis AS va
      FROM external_properties
     WHERE is_active AND images <> '{}'
     ORDER BY created_at DESC
     LIMIT greatest(coalesce(_scan, 200), 0)
  )
  SELECT r.id FROM recent r
   WHERE NOT (
         coalesce(CASE WHEN jsonb_typeof(r.va->'styles') = 'array' THEN jsonb_array_length(r.va->'styles') > 0 END, false)
     AND coalesce(CASE WHEN jsonb_typeof(r.va->'colors') = 'array' THEN jsonb_array_length(r.va->'colors') > 0 END, false)
     AND coalesce(CASE WHEN jsonb_typeof(r.va->'activities') = 'array' THEN jsonb_array_length(r.va->'activities') > 0 END, false)
     AND coalesce(CASE WHEN jsonb_typeof(r.va->'image_analyses') = 'array' THEN jsonb_array_length(r.va->'image_analyses') > 0 END, false)
     AND EXISTS (
           SELECT 1 FROM unnest(coalesce(r.highlights, '{}'::text[])) h
            WHERE coalesce(h, '') NOT IN ('', 'Premium living space feature', 'Quality living space'))
     AND EXISTS (
           SELECT 1
             FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.va->'image_analyses') = 'array'
                                            THEN r.va->'image_analyses' ELSE '[]'::jsonb END) a
            WHERE jsonb_typeof(a) = 'object'
              AND coalesce(a->>'image_index', '') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
              AND (a->>'image_index')::numeric > 0
              AND coalesce(nullif(a->>'image_highlight', ''), a->>'highlight', '')
                    NOT IN ('', 'Premium living space feature', 'Quality living space'))
   )
   ORDER BY r.created_at DESC
$$;

-- ── 1b. backfill-image-highlights' scan ─────────────────────────────────────
-- The same test as `hasMissingHighlights` (missing_only, the default) or
-- "not complete" in backfill-image-highlights/index.ts, which still judges
-- every row this returns. Newest first, across at most `_scan` rows - the
-- function's own 5000-row safety cap. `_legacy_policy` is
-- LEGACY_ANALYZE_COUNT from _shared/vibe-policy.ts, passed in so the number
-- lives in one place.
CREATE OR REPLACE FUNCTION public.image_highlight_backfill_candidates(
  _limit integer DEFAULT 10,
  _missing_only boolean DEFAULT true,
  _legacy_policy integer DEFAULT 5,
  _scan integer DEFAULT 5000
)
RETURNS SETOF uuid
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH scanned AS (
    SELECT id, created_at, images, highlights, vibe_status, vibe_analysis AS va
      FROM external_properties
     ORDER BY created_at DESC
     LIMIT greatest(coalesce(_scan, 5000), 0)
  ), judged AS (
    SELECT s.id, s.created_at, s.vibe_status, s.va,
           coalesce(array_length(s.images, 1), 0) AS image_count,
           (SELECT count(*) FROM unnest(coalesce(s.highlights, '{}'::text[])) h
             WHERE btrim(coalesce(h, ''), E' \t\r\n') <> '') AS highlight_count,
           CASE
             WHEN jsonb_typeof(s.va->'highlight_policy') = 'number'
                  AND (s.va->>'highlight_policy')::numeric > 0
               THEN (s.va->>'highlight_policy')::numeric
             WHEN jsonb_typeof(s.va->'highlight_policy') = 'string'
                  AND s.va->>'highlight_policy' ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
                  AND (s.va->>'highlight_policy')::numeric > 0
               THEN (s.va->>'highlight_policy')::numeric
             ELSE _legacy_policy
           END AS policy,
           CASE WHEN jsonb_typeof(s.va->'image_analyses') = 'array'
                THEN s.va->'image_analyses' ELSE '[]'::jsonb END AS analyses
      FROM scanned s
  )
  SELECT j.id FROM judged j
   WHERE j.image_count > 0
     AND CASE
           WHEN NOT coalesce(_missing_only, true) THEN j.vibe_status IS DISTINCT FROM 'complete'
           WHEN coalesce(j.va->'image_backfill'->'unfixable' = 'true'::jsonb, false) THEN false
           WHEN j.highlight_count < least(j.image_count, j.policy) THEN true
           WHEN jsonb_array_length(j.analyses) = 0 THEN true
           ELSE EXISTS (
             SELECT 1 FROM jsonb_array_elements(j.analyses) a
              WHERE btrim(coalesce(CASE WHEN jsonb_typeof(a) = 'object' THEN a->>'image_highlight' END, ''), E' \t\r\n') = ''
                 OR coalesce(CASE WHEN jsonb_typeof(a) = 'object' THEN a->>'detailed_analysis' END, '')
                      ~* 'rate.?limit|api error|rate_limit_exceeded|analysis failed')
         END
   ORDER BY j.created_at DESC
   LIMIT greatest(coalesce(_limit, 10), 0)
$$;

-- Service role only: these are for the crawl functions, not the browser.
REVOKE ALL ON FUNCTION public.vibe_backfill_candidates(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.image_highlight_backfill_candidates(integer, boolean, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vibe_backfill_candidates(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.image_highlight_backfill_candidates(integer, boolean, integer, integer) TO service_role;

-- ── 2a. process-vibe-queue: only when the queue holds something ─────────────
-- 720 runs a day, nearly all finding the queue empty. 'processing' counts too:
-- the function's first job is reclaiming claims that went stale. The command
-- carries its bearer token inline, so it is edited in place rather than
-- rewritten here, and only once.
DO $$
BEGIN
  PERFORM cron.alter_job(
    job_id  := j.jobid,
    command := regexp_replace(j.command, ';\s*$', '')
               || E'\n  WHERE EXISTS (SELECT 1 FROM public.vibe_analysis_queue WHERE status IN (''queued'', ''processing''));\n'
  )
  FROM cron.job j
  WHERE j.jobname = 'process-vibe-queue-every-2min'
    AND j.username = current_user
    AND j.command NOT LIKE '%vibe_analysis_queue%';
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'process-vibe-queue cron left as it was: %', SQLERRM;
END $$;

-- ── 2b. ai-operator-plan: only while a request is inside its horizon ────────
-- The planner scans viewing requests from the last 21 days (plan-run.ts) and
-- does nothing else; with none, each run still made ~10 calls to read the
-- autonomy gate and log "scanned 0".
DO $$
BEGIN
  PERFORM cron.schedule(
    'ai-operator-plan',
    '3,13,23,33,43,53 * * * *',
    $cmd$
  SELECT net.http_post(
    url := 'https://gbgrwjdmytaksrztcyzs.supabase.co/functions/v1/ai-operator-plan',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  )
  WHERE EXISTS (
    SELECT 1 FROM public.viewing_requests WHERE created_at >= now() - interval '21 days'
  );
  $cmd$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ai-operator-plan cron left as it was: %', SQLERRM;
END $$;

-- ── 3. price-crosscheck: every 3 hours ──────────────────────────────────────
-- A full pass reads every active listing's description (~0.5 MB). Listings
-- and their descriptions change by the day, not by the half hour.
DO $$
BEGIN
  PERFORM cron.alter_job(job_id := j.jobid, schedule := '7 */3 * * *')
  FROM cron.job j
  WHERE j.jobname = 'price-crosscheck' AND j.username = current_user;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'price-crosscheck cron left as it was: %', SQLERRM;
END $$;

-- ── 4. the duplicate verify job ─────────────────────────────────────────────
-- 'verify-external-listings' already runs every 20 minutes; the daily job
-- called the same function with an empty body, which it treats the same way.
DO $$
BEGIN
  PERFORM cron.unschedule(j.jobid)
  FROM cron.job j
  WHERE j.jobname = 'verify-external-listings-daily' AND j.username = current_user;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'verify-external-listings-daily left scheduled: %', SQLERRM;
END $$;
