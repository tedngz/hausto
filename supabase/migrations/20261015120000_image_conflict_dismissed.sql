-- An ops "Legit" on a suspected bait listing (ImageConflictsPanel). The nightly
-- dedupe resets image_location_conflict on every run, so the dismissal cannot
-- live in that flag: it lives here, and dedupe-external-listings only re-flags
-- a dismissed listing over photo reuse by a listing created after it.
ALTER TABLE public.external_properties
ADD COLUMN IF NOT EXISTS image_conflict_dismissed_at TIMESTAMPTZ DEFAULT NULL;
