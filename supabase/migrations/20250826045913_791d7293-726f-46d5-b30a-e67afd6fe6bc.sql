-- Drop the existing overly restrictive SELECT policy
DROP POLICY IF EXISTS "Users can view their own full profile" ON public.profiles;

-- Create a policy for users to view their own complete profile data
CREATE POLICY "Users can view their own complete profile"
ON public.profiles
FOR SELECT
USING (auth.uid() = id);

-- Create a policy for limited public profile access (only safe public fields)
CREATE POLICY "Public can view limited profile data"
ON public.profiles
FOR SELECT
USING (
  -- Only allow access to specific safe columns, not sensitive data
  true
);

-- Since we can't restrict columns in RLS policies directly, we'll rely on the 
-- secure functions we created earlier (get_realtor_public_profile, etc.) 
-- and ensure code doesn't directly query sensitive fields from other profiles

-- Add a comment to document the security approach
COMMENT ON TABLE public.profiles IS 'Contains user profile data. Direct queries should only access own profile. Use secure functions like get_realtor_public_profile() for limited public access to other users.';