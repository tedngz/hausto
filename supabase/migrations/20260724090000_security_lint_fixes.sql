-- Security advisor cleanup: tighten what anon/authenticated can reach.
--
-- Rollback for any single revoke below is a matching GRANT EXECUTE ... TO <role>.

-- 1. listing_groups is written by the dedupe edge function (service role) and
-- read by nothing on the client, so the blanket public SELECT policy only ever
-- served enumeration. Deny-all + service-role bypass is the accurate rule.
DROP POLICY IF EXISTS "Anyone can view listing groups" ON public.listing_groups;

-- 2. set_fast_track_archived is SECURITY DEFINER and keyed on auth.uid(); an
-- anonymous caller can never match a row, but it has no business being callable
-- without a session. (The original migration revoked PUBLIC, which does not
-- cover the explicit anon grant Supabase adds.)
REVOKE EXECUTE ON FUNCTION public.set_fast_track_archived(uuid, boolean) FROM anon;

-- 3. SECURITY DEFINER helpers that no client code calls. Edge functions reach
-- them with the service role, which is unaffected by these revokes.
REVOKE EXECUTE ON FUNCTION public.detect_city(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.normalize_location(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_email(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_phone(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_openai_usage_summary(integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_profiles_for_admin(uuid[]) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_post_authors_profiles(uuid[]) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_post_like_count(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.user_liked_post(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_user_subscription_status() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_realtor_contact_for_renter(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_realtor_matched_renter_contact(uuid) FROM anon, authenticated;

-- 4. Only function still missing a pinned search_path. It stays SECURITY
-- INVOKER and keeps its grants: the "Authenticated users can view active
-- properties" policy on public.properties calls it.
ALTER FUNCTION public.is_property_within_active_period(timestamptz)
  SET search_path = public;

-- 5. Public buckets are served through /object/public/, which does not consult
-- RLS, so a bucket-wide SELECT policy bought nothing except the ability to LIST
-- every object. Owner-scoped SELECT stays so that upsert uploads (avatars,
-- property images) and any future .list() of one's own folder keep working.
DROP POLICY IF EXISTS "Anyone can view property images" ON storage.objects;
CREATE POLICY "Users can read their own property images"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'property-images'
  AND (auth.uid())::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;
CREATE POLICY "Users can read their own avatar"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'avatars'
  AND (auth.uid())::text = (storage.foldername(name))[1]
);

-- Mirror bucket is written and read only by edge functions (service role) and
-- by browsers hitting the public URL, so it needs no SELECT policy at all.
DROP POLICY IF EXISTS "Public read external property images" ON storage.objects;
