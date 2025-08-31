-- Drop and recreate the get_matched_public_profiles function to include avatar_url
DROP FUNCTION IF EXISTS public.get_matched_public_profiles(uuid[]);

CREATE OR REPLACE FUNCTION public.get_matched_public_profiles(user_ids UUID[])
RETURNS TABLE(id UUID, name TEXT, avatar_url TEXT)
LANGUAGE sql
SECURITY DEFINER
AS $$
  -- Only return names and avatars for users who have matches - NO email/phone exposure
  SELECT p.id, COALESCE(p.name, 'Anonymous User') AS name, p.avatar_url
  FROM public.profiles p
  WHERE p.id = ANY (user_ids)
    AND auth.uid() IS NOT NULL  -- Require authentication
    AND (
      p.id = auth.uid() OR EXISTS (
        SELECT 1 FROM public.property_matches m
        WHERE (m.renter_id = p.id AND m.realtor_id = auth.uid())
           OR (m.realtor_id = p.id AND m.renter_id = auth.uid())
      )
    );
$$;