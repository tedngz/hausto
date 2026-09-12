-- Per-source, per-run crawl telemetry (PLAN-v3 S1.1).
--
-- The gap this closes, in the plan's own words: "a run that rejects 100% of
-- candidates currently reports success". nhatot was crawled daily for 35 days
-- while rejecting every candidate as `too_few_images:1`, and every one of those
-- runs logged success. Finding it took a database dig through
-- `crawler_rejections`, because nothing aggregated a run.
--
-- `crawler_rejections` already records each rejected candidate one row at a
-- time. What was missing is the denominator - how many were attempted, how many
-- survived - which is the difference between "this source is quiet" and "this
-- source is broken", and those are different diagnoses with different fixes.

CREATE TABLE IF NOT EXISTS public.crawl_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source       text NOT NULL,
  location     text,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,

  -- The denominator, and where everything went. `attempted` counts candidates
  -- the scraper actually saw; the rest must sum to it or the accounting is
  -- wrong, which is itself worth seeing.
  attempted    integer NOT NULL DEFAULT 0,
  written      integer NOT NULL DEFAULT 0,
  updated      integer NOT NULL DEFAULT 0,
  duplicates   integer NOT NULL DEFAULT 0,
  rejected     integer NOT NULL DEFAULT 0,

  -- {"too_few_images:1": 47, "price_below_floor": 3} - the shape that names
  -- the fault. A single reason at 100% is the nhatot signature.
  reasons      jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- False when the run looked successful but produced nothing it should have.
  -- The whole point: a green run and a healthy run stopped being the same
  -- thing the day the fallback started returning cover images only.
  healthy      boolean NOT NULL DEFAULT true,
  verdict      text,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- "Active rows written per source per day" is PLAN-v3's second number to
-- watch - the one that would have caught nhatot 35 days earlier. This is the
-- read behind it.
CREATE INDEX IF NOT EXISTS crawl_runs_source_time_idx
  ON public.crawl_runs (source, started_at DESC);

CREATE INDEX IF NOT EXISTS crawl_runs_unhealthy_idx
  ON public.crawl_runs (started_at DESC)
  WHERE NOT healthy;

ALTER TABLE public.crawl_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read crawl_runs" ON public.crawl_runs;
CREATE POLICY "Admins read crawl_runs" ON public.crawl_runs
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::app_role));

-- The dashboard query, as a view so it is answered the same way every time.
-- A source absent from this for a day is the alarm; a source present with
-- written = 0 across every run is the louder one.
CREATE OR REPLACE VIEW public.crawl_health
WITH (security_invoker = true) AS
SELECT
  source,
  date_trunc('day', started_at)                              AS day,
  count(*)                                                   AS runs,
  count(*) FILTER (WHERE NOT healthy)                        AS unhealthy_runs,
  sum(attempted)                                             AS attempted,
  sum(written)                                               AS written,
  sum(rejected)                                              AS rejected,
  -- Rejection share, the figure that was invisible. NULL rather than 0 when
  -- nothing was attempted: "we tried nothing" and "we rejected nothing" are
  -- not the same reading, and averaging them together is how this hid.
  CASE WHEN sum(attempted) > 0
       THEN round(sum(rejected)::numeric / sum(attempted), 3)
  END                                                        AS rejection_rate
FROM public.crawl_runs
GROUP BY source, date_trunc('day', started_at);

COMMENT ON VIEW public.crawl_health IS
  'Rows written per source per day, with the rejection share. PLAN-v3 S1: the number that would have caught nhatot 35 days earlier.';

-- Telemetry is not worth a growing table forever. 90 days is long enough to
-- see a seasonal pattern and short enough that nobody has to think about it.
DELETE FROM public.crawl_runs WHERE started_at < now() - interval '90 days';
