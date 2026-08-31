-- Deep vibe analysis: the thing a Hausto Pass is actually for.
--
-- The basic vibe score says how well a listing matches stated preferences. The
-- deep read is a different question - what is this place actually like to live
-- in, read off the photos - and it's the part a renter abroad cannot do for
-- themselves. Generated on demand, because generating it for every listing in
-- the catalogue would cost far more than the passes would earn.
--
-- Cached per renter, per listing, per preference shape. The preference part
-- matters: "suits you" is a different answer once the renter changes their
-- budget or districts, so a changed profile has to produce a fresh read rather
-- than serve a stale one.
--
-- Rows outlive the pass that paid for them. A renter whose pass has lapsed can
-- still read what they already generated - clawing back something they've read
-- would be punitive, and they can't generate more without buying again anyway.

CREATE TABLE IF NOT EXISTS public.listing_deep_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  renter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  property_id uuid NOT NULL,
  -- Listings live in two tables and ids are only unique within each.
  property_type text NOT NULL DEFAULT 'internal'
    CHECK (property_type IN ('internal', 'external')),
  -- Hash of the preferences the read was written against; a changed profile
  -- misses the cache instead of serving an answer written for someone else.
  preference_fingerprint text NOT NULL,
  analysis jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT listing_deep_analyses_unique
    UNIQUE (renter_id, property_id, property_type, preference_fingerprint)
);

ALTER TABLE public.listing_deep_analyses ENABLE ROW LEVEL SECURITY;

-- Read-only for the renter who paid for it, pass or no pass. Writes go through
-- the edge function, which is what checks the pass.
DROP POLICY IF EXISTS "Renters can read their own deep analyses" ON public.listing_deep_analyses;
CREATE POLICY "Renters can read their own deep analyses"
ON public.listing_deep_analyses
FOR SELECT
TO authenticated
USING (auth.uid() = renter_id);

REVOKE INSERT, UPDATE, DELETE ON public.listing_deep_analyses FROM authenticated, anon;

CREATE INDEX IF NOT EXISTS idx_deep_analyses_renter_listing
  ON public.listing_deep_analyses(renter_id, property_id, property_type);
