-- Drop the existing problematic policy
DROP POLICY IF EXISTS "Public can view realtor names for properties" ON public.profiles;

-- Create a new restrictive policy: users can only see their own full profiles
CREATE POLICY "Users can view their own full profile"
ON public.profiles
FOR SELECT
USING (auth.uid() = id);

-- Create a secure function to get only public realtor profile info (name and bio only)
CREATE OR REPLACE FUNCTION public.get_realtor_public_profile(realtor_id uuid)
RETURNS TABLE(id uuid, name text, bio text, avatar_url text, location text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  -- Only return basic public info for realtors who have properties
  SELECT p.id, p.name, p.bio, p.avatar_url, p.location
  FROM public.profiles p
  WHERE p.id = realtor_id
    AND EXISTS (
      SELECT 1 FROM public.properties prop
      WHERE prop.realtor_id = p.id
    );
$$;

-- Update the existing function to only return name (no sensitive data)
CREATE OR REPLACE FUNCTION public.get_matched_public_profiles(user_ids uuid[])
RETURNS TABLE(id uuid, name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  -- Only return names for users who have matches or properties
  SELECT p.id, COALESCE(p.name, '') AS name
  FROM public.profiles p
  WHERE p.id = ANY (user_ids)
    AND (
      p.id = auth.uid() OR EXISTS (
        SELECT 1 FROM public.property_matches m
        WHERE (m.renter_id = p.id AND m.realtor_id = auth.uid())
           OR (m.realtor_id = p.id AND m.renter_id = auth.uid())
      ) OR EXISTS (
        SELECT 1 FROM public.properties prop
        WHERE prop.realtor_id = p.id
      )
    );
$$;