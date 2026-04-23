-- Add vibe_status to external_properties
ALTER TABLE public.external_properties
  ADD COLUMN IF NOT EXISTS vibe_status text NOT NULL DEFAULT 'pending';

ALTER TABLE public.external_properties
  DROP CONSTRAINT IF EXISTS external_properties_vibe_status_check;

ALTER TABLE public.external_properties
  ADD CONSTRAINT external_properties_vibe_status_check
  CHECK (vibe_status IN ('pending','processing','complete','rejected_no_interior'));

CREATE INDEX IF NOT EXISTS idx_external_properties_vibe_status
  ON public.external_properties (vibe_status);

-- Crawler rejections log
CREATE TABLE IF NOT EXISTS public.crawler_rejections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url text NOT NULL,
  source text NOT NULL,
  reason text NOT NULL,
  sample_images jsonb NOT NULL DEFAULT '[]'::jsonb,
  rejected_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crawler_rejections_rejected_at
  ON public.crawler_rejections (rejected_at DESC);

ALTER TABLE public.crawler_rejections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view crawler rejections" ON public.crawler_rejections;
CREATE POLICY "Admins can view crawler rejections"
  ON public.crawler_rejections FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can insert crawler rejections" ON public.crawler_rejections;
CREATE POLICY "Admins can insert crawler rejections"
  ON public.crawler_rejections FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can delete crawler rejections" ON public.crawler_rejections;
CREATE POLICY "Admins can delete crawler rejections"
  ON public.crawler_rejections FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Vibe analysis queue
CREATE TABLE IF NOT EXISTS public.vibe_analysis_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL,
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  status text NOT NULL DEFAULT 'queued',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vibe_analysis_queue_status_check
    CHECK (status IN ('queued','processing','complete','failed'))
);

CREATE INDEX IF NOT EXISTS idx_vibe_queue_status_enqueued
  ON public.vibe_analysis_queue (status, enqueued_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vibe_queue_property_active
  ON public.vibe_analysis_queue (property_id)
  WHERE status IN ('queued','processing');

ALTER TABLE public.vibe_analysis_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view vibe queue" ON public.vibe_analysis_queue;
CREATE POLICY "Admins can view vibe queue"
  ON public.vibe_analysis_queue FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP TRIGGER IF EXISTS update_vibe_queue_updated_at ON public.vibe_analysis_queue;
CREATE TRIGGER update_vibe_queue_updated_at
  BEFORE UPDATE ON public.vibe_analysis_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();