-- Captured questions close themselves after 7 days.
--
-- The queue's failure mode is not too little attention, it is a backlog nobody
-- ever drains: 8 escalations sat pending for 41 days under the old chat flow
-- while the renter had been told to expect a reply. Nothing now promises the
-- renter a response, so an unanswered capture is a gap in our listing data
-- rather than a debt - it should age out on its own.
--
-- Run: bash scripts/supabase-sql.sh scripts/sql/03-expire-stale-captures.sql
CREATE OR REPLACE FUNCTION public.expire_stale_escalations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE concierge_escalations
     SET status = 'dismissed', updated_at = now()
   WHERE status = 'pending'
     AND created_at < now() - interval '7 days';
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

-- Daily at 02:30 UTC, off the hour so it does not pile onto the hourly jobs.
SELECT cron.unschedule('expire-stale-escalations')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-stale-escalations');

SELECT cron.schedule(
  'expire-stale-escalations',
  '30 2 * * *',
  $$SELECT public.expire_stale_escalations();$$
);
