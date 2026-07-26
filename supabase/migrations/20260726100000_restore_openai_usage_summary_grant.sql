-- The security lint pass (20260724090000) revoked EXECUTE on
-- get_openai_usage_summary from anon + authenticated on the assumption that no
-- client code called it. The admin "OpenAI Usage & Cost" panel does call it
-- directly from the browser with an authenticated admin JWT, so PostgREST has
-- been returning permission denied ever since and the panel renders its empty
-- state unconditionally.
--
-- Granting back to authenticated is safe: the function is SECURITY DEFINER but
-- its own WHERE clause requires public.has_role(auth.uid(), 'admin'), so a
-- non-admin session gets zero rows rather than data. anon stays revoked.
--
-- While recreating it, add `model` to the grouping: the panel's Row type and
-- its raw-row list already reference r.model, which was always undefined.

DROP FUNCTION IF EXISTS public.get_openai_usage_summary(INTEGER);

CREATE FUNCTION public.get_openai_usage_summary(_days INTEGER DEFAULT 7)
RETURNS TABLE(
  day DATE,
  fn TEXT,
  model TEXT,
  calls BIGINT,
  prompt_tokens BIGINT,
  completion_tokens BIGINT,
  images BIGINT,
  estimated_usd NUMERIC
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (created_at AT TIME ZONE 'UTC')::date AS day,
    fn,
    model,
    COUNT(*)::bigint AS calls,
    SUM(prompt_tokens)::bigint AS prompt_tokens,
    SUM(completion_tokens)::bigint AS completion_tokens,
    SUM(images)::bigint AS images,
    ROUND(SUM(estimated_usd)::numeric, 4) AS estimated_usd
  FROM public.openai_usage_log
  WHERE created_at >= now() - (_days || ' days')::interval
    AND public.has_role(auth.uid(), 'admin')
  GROUP BY 1, 2, 3
  ORDER BY 1 DESC, estimated_usd DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_openai_usage_summary(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_openai_usage_summary(INTEGER) TO authenticated;
