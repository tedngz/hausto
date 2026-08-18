-- Security advisor follow-up for the listing-history work
-- (20260817120000_listing_history_snapshots.sql, 20260810120000_free_viewing_trial.sql).
--
-- Rollback for the grant changes is the matching GRANT; rollback for the policy
-- is the original `USING (true)`.

-- 1. external_property_snapshots was readable by anyone with USING (true),
-- which exposed the full change history of listings that are no longer active -
-- broader than the parent table, where anon only ever sees is_active rows.
-- Scoping the policy to the parent listing's visibility makes history exactly as
-- public as the listing it belongs to: anon and signed-in renters see active
-- listings, admins see everything (their "Admins can view all external
-- properties" policy makes the EXISTS succeed for inactive rows too).
DROP POLICY IF EXISTS "Anyone can view listing snapshots" ON public.external_property_snapshots;
CREATE POLICY "Listing snapshots follow their listing"
ON public.external_property_snapshots
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.external_properties p
    WHERE p.id = external_property_snapshots.listing_id
  )
);

-- 2. Column-level grants. The client only ever reads observed_at + price
-- (src/hooks/useListingHistory.tsx); contact_phone_hash and content_hash exist
-- for change detection, not for display. An md5 of a Vietnamese mobile number is
-- trivially brute-forced from a known number space, so it should never have been
-- on the wire in the first place. Writes stay service-role/trigger-only.
REVOKE ALL ON TABLE public.external_property_snapshots FROM anon, authenticated;
GRANT SELECT (id, listing_id, observed_at, price, size, rooms, title, is_active)
  ON public.external_property_snapshots TO anon, authenticated;

-- 3. Trigger functions are fired by the trigger machinery, which does not check
-- EXECUTE at fire time (the privilege is checked when the trigger is created),
-- so revoking the default anon/authenticated grants costs nothing and takes them
-- off the "SECURITY DEFINER function callable by anon" advisor list.
REVOKE EXECUTE ON FUNCTION public.capture_external_property_snapshot() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_viewing_trial_used() FROM PUBLIC, anon, authenticated;
