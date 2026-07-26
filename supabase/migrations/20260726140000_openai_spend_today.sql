-- Fallback for the edge-function spend guard in _shared/openai-usage.ts.
--
-- The guard reads a Redis counter on the hot path, but Redis is best-effort:
-- if it is unreachable the guard would have no idea what has been spent and
-- would fail open. Summing the log is the authoritative answer, so it backs
-- the counter up.
--
-- service_role only. This is called by edge functions, never by a browser, and
-- it deliberately does NOT gate on has_role(auth.uid()) the way
-- get_openai_usage_summary does, so it must not be reachable by PostgREST
-- callers holding an anon or authenticated JWT.

CREATE OR REPLACE FUNCTION public.openai_spend_today()
RETURNS NUMERIC
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(estimated_usd), 0)::numeric
  FROM public.openai_usage_log
  WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC');
$$;

REVOKE EXECUTE ON FUNCTION public.openai_spend_today() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.openai_spend_today() TO service_role;
