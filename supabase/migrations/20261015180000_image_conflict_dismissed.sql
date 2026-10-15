-- An ops "Legit" on a suspected bait listing (ImageConflictsPanel). The nightly
-- dedupe resets image_location_conflict on every run, so the dismissal cannot
-- live in that flag: it lives here, and dedupe-external-listings only re-flags
-- a dismissed listing over photo reuse by a listing created after it.
ALTER TABLE public.external_properties
ADD COLUMN IF NOT EXISTS image_conflict_dismissed_at TIMESTAMPTZ DEFAULT NULL;

-- external_properties grants SELECT column by column (20260708165420), so a
-- new column is unreadable until named here, and a query naming it is refused
-- whole (20261015170000). The panel only writes it today, through the
-- table-level UPDATE authenticated already holds; this lets an admin screen
-- read it too. authenticated only, like the flag itself. Idempotent.
GRANT SELECT (image_conflict_dismissed_at) ON public.external_properties TO authenticated;
