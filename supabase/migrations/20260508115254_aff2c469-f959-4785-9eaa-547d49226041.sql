
-- 1) direct_messages: respect soft-delete in SELECT
DROP POLICY IF EXISTS "Users can view messages in their conversations" ON public.direct_messages;
CREATE POLICY "Users can view messages in their conversations"
  ON public.direct_messages FOR SELECT
  USING (
    (auth.uid() = sender_id OR auth.uid() = receiver_id)
    AND NOT (auth.uid() = ANY (COALESCE(deleted_by, '{}'::uuid[])))
  );

-- 2) storage.objects: tighten property-images INSERT to user-owned folder
DROP POLICY IF EXISTS "Authenticated users can upload property images" ON storage.objects;
CREATE POLICY "Users can upload to their own property-images folder"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'property-images'
    AND auth.role() = 'authenticated'
    AND (auth.uid())::text = (storage.foldername(name))[1]
  );

-- 3) profiles: stop exposing email/phone of every realtor to every authenticated user.
-- Drop the broad realtor-profile SELECT policy and provide a SECURITY DEFINER RPC
-- that returns only safe fields, plus contact info when the realtor opted in.
DROP POLICY IF EXISTS "Authenticated users can view realtor profiles for active proper" ON public.profiles;

CREATE OR REPLACE FUNCTION public.get_realtor_public_profiles(user_ids uuid[])
RETURNS TABLE (
  id uuid,
  name text,
  avatar_url text,
  bio text,
  location text,
  email text,
  phone text,
  allow_contact_sharing boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.name,
    p.avatar_url,
    p.bio,
    p.location,
    CASE WHEN p.allow_contact_sharing THEN p.email ELSE NULL END AS email,
    CASE WHEN p.allow_contact_sharing THEN p.phone ELSE NULL END AS phone,
    COALESCE(p.allow_contact_sharing, false) AS allow_contact_sharing
  FROM public.profiles p
  WHERE p.id = ANY(user_ids)
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.properties pr
      WHERE pr.realtor_id = p.id
        AND pr.is_active = true
        AND public.is_property_within_active_period(pr.last_activated_at)
    );
$$;

REVOKE ALL ON FUNCTION public.get_realtor_public_profiles(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_realtor_public_profiles(uuid[]) TO authenticated;
