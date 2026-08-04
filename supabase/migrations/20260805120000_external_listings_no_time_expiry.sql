-- External crawled listings no longer expire on a timer.
--
-- A crawled listing is a mirror of a live source page, not a realtor's own
-- posting: the only honest signal that it is gone is the source URL going
-- dead, which verify-external-listings already checks every 2-5 days and
-- deactivates after 2 consecutive dead results. The 10-day expires_at clock
-- on top of that hid listings that were still live on nhatot/batdongsan.
-- Time-based expiry stays in place for realtor self-uploaded properties
-- (public.properties / deactivate_expired_properties).

-- expires_at is kept for schema/type compatibility but is now effectively
-- "never": far-future so any stray filter still passes.
ALTER TABLE public.external_properties
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '100 years');

UPDATE public.external_properties
SET expires_at = now() + interval '100 years'
WHERE expires_at < now() + interval '50 years';

-- RLS: is_active (i.e. the source link is still live) decides visibility.
DROP POLICY IF EXISTS "Authenticated users can view active external properties" ON public.external_properties;
CREATE POLICY "Authenticated users can view active external properties"
ON public.external_properties
FOR SELECT
TO authenticated
USING (is_active = true);

DROP POLICY IF EXISTS "Anyone can view active external properties by direct link" ON public.external_properties;
CREATE POLICY "Anyone can view active external properties by direct link"
ON public.external_properties
FOR SELECT
TO public
USING (is_active = true);

-- Neutered rather than dropped: other objects/jobs may still reference it.
CREATE OR REPLACE FUNCTION public.cleanup_expired_external_properties()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- No-op: external listings are retired by verify-external-listings when
  -- their source URL goes dead, never by elapsed time.
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_expired_external_properties() FROM PUBLIC, anon, authenticated;

-- Drop any cron job still calling the old cleanup.
DO $$
BEGIN
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE command ILIKE '%cleanup_expired_external_properties%';
EXCEPTION WHEN undefined_table OR undefined_function OR insufficient_privilege THEN
  NULL;
END;
$$;

DROP INDEX IF EXISTS idx_external_properties_expires;

-- One-time revival: listings retired by the clock rather than by a dead link.
-- Excluded: anything verification found dead (deactivated_at set or status
-- 'dead'), raw harvested rows, and rows still awaiting vibe analysis.
-- last_verified_at is cleared so they sort to the front of the verification
-- queue (nullsFirst) and get a liveness check within the next few runs.
UPDATE public.external_properties
SET is_active = true,
    last_verified_at = NULL,
    verification_failures = 0,
    last_verification_status = NULL,
    last_verification_reason = NULL
WHERE is_active = false
  AND deactivated_at IS NULL
  AND (last_verification_status IS NULL OR last_verification_status <> 'dead')
  AND raw_only = false
  AND vibe_status = 'complete';
