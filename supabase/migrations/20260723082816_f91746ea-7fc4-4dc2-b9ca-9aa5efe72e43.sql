
CREATE TABLE public.openai_usage_log (
  id BIGSERIAL PRIMARY KEY,
  fn TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  images INTEGER NOT NULL DEFAULT 0,
  estimated_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_openai_usage_log_created_at ON public.openai_usage_log (created_at DESC);
CREATE INDEX idx_openai_usage_log_fn_created_at ON public.openai_usage_log (fn, created_at DESC);

GRANT SELECT ON public.openai_usage_log TO authenticated;
GRANT ALL ON public.openai_usage_log TO service_role;

ALTER TABLE public.openai_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view usage log"
  ON public.openai_usage_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Aggregated views via SECURITY DEFINER RPC
CREATE OR REPLACE FUNCTION public.get_openai_usage_summary(_days INTEGER DEFAULT 7)
RETURNS TABLE(
  day DATE,
  fn TEXT,
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
    COUNT(*)::bigint AS calls,
    SUM(prompt_tokens)::bigint AS prompt_tokens,
    SUM(completion_tokens)::bigint AS completion_tokens,
    SUM(images)::bigint AS images,
    ROUND(SUM(estimated_usd)::numeric, 4) AS estimated_usd
  FROM public.openai_usage_log
  WHERE created_at >= now() - (_days || ' days')::interval
    AND public.has_role(auth.uid(), 'admin')
  GROUP BY 1, 2
  ORDER BY 1 DESC, estimated_usd DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_openai_usage_summary(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_openai_usage_summary(INTEGER) TO authenticated;
