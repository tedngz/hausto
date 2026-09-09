-- Ninety-day retention for the tables that are genuinely logs.
--
-- Three of the tables that looked like logs are not, and are deliberately left
-- alone:
--
--   external_property_snapshots  price history for a crawled listing, read by
--                                useListingHistory. Trimming it truncates a
--                                chart the renter is looking at.
--   ai_searches / ai_search_results  a renter's saved AI searches, read by
--                                useAISearches. Their own history, not ours.
--   security_audit_log           profile-change forensics. Tiny, and the point
--                                of an audit trail is that it outlives the
--                                incident.
--
-- What is left is telemetry: rows nothing reads after the week they are
-- written, on tables that grow forever. openai_usage_log alone runs about 200
-- rows a day, so a year unattended is some 78,000 rows to keep a fortnight's
-- cost question answerable.
--
-- Neither of the two log tables has a row older than 90 days today - they were
-- only created in July 2026 - so the first runs delete nothing. This caps them
-- before they get large rather than after.

CREATE OR REPLACE FUNCTION public.trim_old_logs(_older_than interval DEFAULT interval '90 days')
RETURNS TABLE(source text, rows_deleted bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n bigint;
BEGIN
  DELETE FROM public.openai_usage_log WHERE created_at < now() - _older_than;
  GET DIAGNOSTICS n = ROW_COUNT;
  source := 'openai_usage_log'; rows_deleted := n; RETURN NEXT;

  DELETE FROM public.crawler_rejections WHERE rejected_at < now() - _older_than;
  GET DIAGNOSTICS n = ROW_COUNT;
  source := 'crawler_rejections'; rows_deleted := n; RETURN NEXT;

  -- Only settled work. A pending or in-flight item is never old enough to drop,
  -- however long it has been sitting there - that would silently cancel it.
  DELETE FROM public.vibe_analysis_queue
  WHERE enqueued_at < now() - _older_than
    AND status IN ('complete', 'failed');
  GET DIAGNOSTICS n = ROW_COUNT;
  source := 'vibe_analysis_queue'; rows_deleted := n; RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.trim_old_logs(interval) FROM PUBLIC, anon, authenticated;

-- Daily, off the hour so it does not land with the 03:00 listing verification.
SELECT cron.unschedule('trim-old-logs')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'trim-old-logs');

SELECT cron.schedule(
  'trim-old-logs',
  '45 3 * * *',
  $$SELECT public.trim_old_logs();$$
);
