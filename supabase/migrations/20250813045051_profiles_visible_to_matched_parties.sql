-- 1) Tighten profiles SELECT access to owners and matched parties only
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;

CREATE POLICY "Users and matched parties can view profile"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  auth.uid() = id OR
  EXISTS (
    SELECT 1 FROM public.property_matches m
    WHERE (m.renter_id = id AND m.realtor_id = auth.uid())
       OR (m.realtor_id = id AND m.renter_id = auth.uid())
  )
);

-- Keep existing insert/update policies (already restricted to authenticated)

-- 2) Create a secure RPC to expose only id + name for public/social feed
CREATE OR REPLACE FUNCTION public.get_public_profiles(user_ids uuid[])
RETURNS TABLE (id uuid, name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, COALESCE(p.name, '') AS name
  FROM public.profiles p
  WHERE p.id = ANY (user_ids);
$$;

-- Allow both anon and authenticated to call this RPC for read-only public data
GRANT EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) TO anon, authenticated;