-- Stable unit identity across dedupe runs.
--
-- dedupe-external-listings used to DELETE every row in listing_groups and
-- re-insert with fresh UUIDs each night, so nothing could reference a physical
-- unit across time. Groups are now matched to the previous run by member
-- overlap and keep their id; only genuinely new clusters mint a UUID.
--
-- The clustering pull also used to be restricted to is_active = true, which
-- erased a unit's identity as soon as its ads expired. Recently deactivated
-- listings are now included, which makes relist detection fall out of the
-- existing image-fingerprint pass: a fresh posting of a unit we saw before
-- shares the landlord's photo set and lands in the same group.
--
-- member_count keeps its existing meaning (ACTIVE postings for this unit) so
-- public-property-search's duplicate-excess stat stays correct;
-- total_member_count adds the historical members.

ALTER TABLE public.listing_groups
ADD COLUMN IF NOT EXISTS total_member_count INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ;

-- An active listing whose unit we have seen listed before, under a posting that
-- has since died. Recomputed on every dedupe run.
ALTER TABLE public.external_properties
ADD COLUMN IF NOT EXISTS is_relist BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_external_properties_relist
ON public.external_properties (is_relist)
WHERE is_relist = TRUE;

-- Members are matched back to their previous group by listing id, so the
-- rebuild needs a cheap reverse lookup from group -> members.
CREATE INDEX IF NOT EXISTS idx_listing_groups_first_seen
ON public.listing_groups (first_seen_at DESC NULLS LAST);
