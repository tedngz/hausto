-- Vibe matching v2: renter "must-have" features (deal-breakers) collected in the
-- onboarding quiz. Stored as a text[] of feature keys (see propertyFeatures.ts).
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS must_haves text[] DEFAULT '{}'::text[];

-- Expose must_haves to matched realtors and drop the retired `colors` field.
-- Return-type change requires DROP + CREATE (CREATE OR REPLACE can't alter columns).
DROP FUNCTION IF EXISTS public.get_renter_preferences_for_realtor(uuid);

CREATE FUNCTION public.get_renter_preferences_for_realtor(renter_id UUID)
RETURNS TABLE (
  styles TEXT[],
  activities TEXT[],
  must_haves TEXT[],
  price_range_min NUMERIC,
  price_range_max NUMERIC,
  size TEXT,
  location TEXT[],
  move_in_date TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  -- Only return preferences if the requesting realtor has a match with this renter
  SELECT
    up.styles,
    up.activities,
    up.must_haves,
    up.price_range_min,
    up.price_range_max,
    up.size,
    up.location,
    up.move_in_date
  FROM public.user_preferences up
  WHERE up.user_id = renter_id
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.property_matches m
      WHERE m.renter_id = renter_id
        AND m.realtor_id = auth.uid()
    );
$$;
