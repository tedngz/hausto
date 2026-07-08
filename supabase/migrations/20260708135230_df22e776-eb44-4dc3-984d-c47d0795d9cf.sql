
-- 1) Fix SET search_path on the two SECURITY DEFINER functions missing it

CREATE OR REPLACE FUNCTION public.update_conversation_on_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  UPDATE public.match_conversations
  SET
    last_message_at = NEW.created_at,
    last_message_preview = LEFT(NEW.content, 100),
    updated_at = NOW()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_matched_public_profiles(user_ids uuid[])
RETURNS TABLE(id uuid, name text, avatar_url text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT p.id, COALESCE(p.name, 'Anonymous User') AS name, p.avatar_url
  FROM public.profiles p
  WHERE p.id = ANY (user_ids)
    AND auth.uid() IS NOT NULL
    AND (
      p.id = auth.uid() OR EXISTS (
        SELECT 1 FROM public.property_matches m
        WHERE (m.renter_id = p.id AND m.realtor_id = auth.uid())
           OR (m.realtor_id = p.id AND m.renter_id = auth.uid())
      )
    );
$function$;

-- 2) Lock down SECURITY DEFINER function EXECUTE privileges
-- Trigger-only functions: no direct callers needed
REVOKE ALL ON FUNCTION public.update_conversation_on_message() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_conversation_on_new_message() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_profile_data() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_profile_changes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_subscriber() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_realtor_application_approval() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_subscription_end_on_manual_upgrade() FROM PUBLIC, anon, authenticated;

-- Admin/maintenance functions: service_role only
REVOKE ALL ON FUNCTION public.activate_user_subscription(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.deactivate_expired_properties() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_expired_external_properties() FROM PUBLIC, anon, authenticated;

-- User-facing SECURITY DEFINER helpers: authenticated only (all check auth.uid() internally)
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;

REVOKE ALL ON FUNCTION public.get_realtor_public_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_realtor_public_profile(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_conversation_properties() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_conversation_properties() TO authenticated;

REVOKE ALL ON FUNCTION public.get_realtor_contact_for_renter(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_realtor_contact_for_renter(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_realtor_matched_renter_contact(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_realtor_matched_renter_contact(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_post_authors_profiles(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_post_authors_profiles(uuid[]) TO authenticated;

REVOKE ALL ON FUNCTION public.get_matched_public_profiles(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_matched_public_profiles(uuid[]) TO authenticated;

REVOKE ALL ON FUNCTION public.get_renter_profile_for_realtor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_renter_profile_for_realtor(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_realtor_public_profiles(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_realtor_public_profiles(uuid[]) TO authenticated;

REVOKE ALL ON FUNCTION public.get_renter_preferences_for_realtor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_renter_preferences_for_realtor(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_external_property_contact(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_external_property_contact(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_external_property_contacts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_external_property_contacts(uuid[]) TO authenticated;

REVOKE ALL ON FUNCTION public.get_user_subscription_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_subscription_status() TO authenticated;

REVOKE ALL ON FUNCTION public.user_liked_post(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_liked_post(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_post_like_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_post_like_count(uuid) TO authenticated;

-- Utility SECURITY DEFINER functions: authenticated only
REVOKE ALL ON FUNCTION public.validate_email(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_email(text) TO authenticated;
REVOKE ALL ON FUNCTION public.validate_phone(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_phone(text) TO authenticated;
REVOKE ALL ON FUNCTION public.normalize_location(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_location(text) TO authenticated;
REVOKE ALL ON FUNCTION public.detect_city(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.detect_city(text) TO authenticated;

-- 3) fast_track_requests: require premium subscription to create
DROP POLICY IF EXISTS "Renters can create their own fast track requests" ON public.fast_track_requests;
CREATE POLICY "Renters can create their own fast track requests"
ON public.fast_track_requests
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = renter_id
  AND EXISTS (
    SELECT 1 FROM public.subscribers s
    WHERE s.user_id = auth.uid()
      AND s.subscribed = true
      AND s.subscription_tier = 'premium'
      AND (s.subscription_end IS NULL OR s.subscription_end > now())
  )
);

-- 4) complex_inquiries: replace WITH CHECK(true) with a minimal validity check
DROP POLICY IF EXISTS "Anyone can submit an inquiry" ON public.complex_inquiries;
CREATE POLICY "Anyone can submit an inquiry"
ON public.complex_inquiries
FOR INSERT
TO anon, authenticated
WITH CHECK (
  complex_id IS NOT NULL
  AND email IS NOT NULL
  AND length(trim(email)) > 3
  AND email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
);

-- 5) subscribers: revoke direct write privileges from authenticated
-- All subscription writes must now go through server-side code (edge functions / service_role)
REVOKE INSERT, UPDATE, DELETE ON public.subscribers FROM authenticated, anon;
GRANT SELECT ON public.subscribers TO authenticated;
GRANT ALL ON public.subscribers TO service_role;
