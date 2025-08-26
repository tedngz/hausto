-- Create a public profiles view that only exposes safe, public information
CREATE OR REPLACE VIEW public.public_profiles AS
SELECT 
  id,
  name,
  bio,
  avatar_url,
  location
FROM public.profiles;

-- Enable RLS on the view
ALTER VIEW public.public_profiles SET (security_barrier = true);

-- Create a secure RLS policy for profiles table that protects sensitive data
DROP POLICY IF EXISTS "Public can view realtor names for properties" ON public.profiles;

-- New restrictive policy: users can only see their own full profiles
CREATE POLICY "Users can view their own full profile"
ON public.profiles
FOR SELECT
USING (auth.uid() = id);

-- Create policies for the public_profiles view
CREATE POLICY "Anyone can view public profile info"
ON public.public_profiles
FOR SELECT
USING (true);

-- Create a secure function to get realtor contact info only when there's a match
CREATE OR REPLACE FUNCTION public.get_realtor_public_profile(realtor_id uuid)
RETURNS TABLE(id uuid, name text, bio text, avatar_url text, location text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  -- Only return public profile info for realtors who have properties
  SELECT p.id, p.name, p.bio, p.avatar_url, p.location
  FROM public.profiles p
  WHERE p.id = realtor_id
    AND EXISTS (
      SELECT 1 FROM public.properties prop
      WHERE prop.realtor_id = p.id
    );
$$;