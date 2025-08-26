-- CRITICAL SECURITY FIX: Remove the overly permissive public access policy
DROP POLICY IF EXISTS "Public can view limited profile data" ON public.profiles;

-- Ensure only users can view their own complete profiles
-- This policy already exists and is secure, but let's confirm it's the only SELECT policy

-- Add an explicit comment about security approach
COMMENT ON TABLE public.profiles IS 'SECURITY: Contains sensitive user data (email, phone). Users can only view their own complete profile. For limited public access to other profiles, use secure functions like get_realtor_public_profile() which return only safe fields.';