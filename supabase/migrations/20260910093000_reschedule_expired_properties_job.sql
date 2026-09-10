-- deactivate-expired-properties has never once succeeded from this owner.
--
-- Like auto-crawl-v2, jobid 5 is owned by `supabase_read_only_user`, and every
-- run for at least the last two days ended:
--
--   ERROR: permission denied for function deactivate_expired_properties
--
-- 48 consecutive failures. The function itself is fine - it is owned by
-- `postgres`, which can execute it; the read-only role cannot.
--
-- The job is NOT dead code, so it is not simply dropped. It enforces the 10-day
-- listing window that the product still shows: RealtorDashboard renders a
-- countdown off `last_activated_at` and lets a realtor re-activate, and
-- useComplexes filters on the same 10-day cutoff. Enforcement being broken has
-- gone unnoticed only because `properties` currently has zero active rows - the
-- newest activation is 2026-07-15. The first realtor to publish would get a
-- listing whose countdown reads expired while `is_active` stayed true.
--
-- The broken job cannot be unscheduled from any role available to us, so this
-- schedules a working one under `postgres` beside it rather than replacing it.
-- The old one keeps failing harmlessly; drop it if Supabase support ever removes
-- the read-only-owned jobs.
SELECT cron.schedule(
  'deactivate-expired-properties-v2',
  '0 * * * *',
  $$SELECT public.deactivate_expired_properties();$$
);
