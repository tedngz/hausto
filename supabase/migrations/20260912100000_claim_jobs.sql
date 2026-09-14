-- Claiming jobs, atomically.
--
-- Two runners overlapping is not hypothetical: a 15-minute cron plus a manual
-- invocation is enough, and the failure is a renter receiving the same holding
-- update twice. `FOR UPDATE SKIP LOCKED` is what makes the claim a claim - the
-- second caller passes over the locked row instead of blocking on it or, worse,
-- reading it as available.
--
-- Idempotency on the send side (SPEC §5) would catch a double anyway, but
-- relying on that means every duplicate becomes a wasted write and a confusing
-- log line. Better not to hand the same job out twice.

CREATE OR REPLACE FUNCTION public.claim_jobs(_kinds text[], _limit int DEFAULT 20)
RETURNS SETOF public.jobs
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  WITH due AS (
    SELECT id
    FROM public.jobs
    WHERE completed_at IS NULL
      AND locked_at IS NULL
      AND run_after <= now()
      AND kind = ANY(_kinds)
    ORDER BY run_after
    LIMIT _limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.jobs j
  SET locked_at = now(), attempts = j.attempts + 1
  FROM due
  WHERE j.id = due.id
  RETURNING j.*;
$$;

-- Only the service role runs jobs. `authenticated` must not be able to claim
-- one: a claimed job that is never completed is a message the renter never
-- gets, and that is a denial of the 24h promise available to anyone with a
-- login.
REVOKE ALL ON FUNCTION public.claim_jobs(text[], int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_jobs(text[], int) TO service_role;

/**
 * Release a job whose run failed, so the next pass retries it.
 *
 * Kept separate from claiming because the two happen at different times and a
 * crash between them must leave the row locked rather than silently free - a
 * job that unlocks itself on a crash is one that runs forever.
 */
CREATE OR REPLACE FUNCTION public.release_job(_id uuid, _error text)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  UPDATE public.jobs
  SET locked_at = NULL, last_error = left(_error, 500)
  WHERE id = _id AND completed_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.release_job(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_job(uuid, text) TO service_role;

-- A job locked for over an hour is a runner that died mid-flight. Reclaiming
-- it is safe: every send behind it is idempotent on (request_id, purpose,
-- attempt), so the worst case is a no-op, and the alternative is a renter
-- waiting forever on a row nobody will touch again.
CREATE OR REPLACE FUNCTION public.unstick_jobs(_older_than interval DEFAULT '1 hour')
RETURNS int
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  WITH freed AS (
    UPDATE public.jobs
    SET locked_at = NULL, last_error = coalesce(last_error, 'reclaimed after stall')
    WHERE completed_at IS NULL AND locked_at IS NOT NULL AND locked_at < now() - _older_than
    RETURNING 1
  )
  SELECT count(*)::int FROM freed;
$$;

REVOKE ALL ON FUNCTION public.unstick_jobs(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unstick_jobs(interval) TO service_role;
