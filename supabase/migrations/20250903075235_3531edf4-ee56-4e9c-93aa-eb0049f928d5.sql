-- Security Enhancement Migration
-- Phase 1: Critical Data Protection

-- 1. Enhance Profile Data Security
-- Add more restrictive RLS policies for profiles table
DROP POLICY IF EXISTS "Users can view their own complete profile" ON public.profiles;

-- Create more granular policies for profile access
CREATE POLICY "Users can view their own profile data" 
ON public.profiles 
FOR SELECT 
USING (auth.uid() = id AND auth.uid() IS NOT NULL);

CREATE POLICY "Users can update only their own profile" 
ON public.profiles 
FOR UPDATE 
USING (auth.uid() = id AND auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() = id AND auth.uid() IS NOT NULL);

CREATE POLICY "Users can insert only their own profile" 
ON public.profiles 
FOR INSERT 
WITH CHECK (auth.uid() = id AND auth.uid() IS NOT NULL);

-- Add policy to prevent profile deletion (security measure)
CREATE POLICY "Prevent profile deletion" 
ON public.profiles 
FOR DELETE 
USING (false);

-- 2. Enhance Subscribers Table Security
-- Add additional RLS policies for subscribers table
CREATE POLICY "Strict subscriber access control" 
ON public.subscribers 
FOR ALL 
USING (auth.uid() = user_id AND auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() = user_id AND auth.uid() IS NOT NULL);

-- 3. Fix Database Function Security
-- Update existing functions to use proper search_path
CREATE OR REPLACE FUNCTION public.get_post_like_count(post_uuid uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $function$
  SELECT COUNT(*)::integer
  FROM public.post_likes
  WHERE post_id = post_uuid;
$function$;

CREATE OR REPLACE FUNCTION public.user_liked_post(post_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER  
SET search_path = 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.post_likes
    WHERE post_id = post_uuid 
      AND user_id = auth.uid()
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_realtor_public_profile(realtor_id uuid)
RETURNS TABLE(id uuid, name text, bio text, avatar_url text, location text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
  -- Only return basic public info for realtors who have properties
  SELECT p.id, p.name, p.bio, p.avatar_url, p.location
  FROM public.profiles p
  WHERE p.id = realtor_id
    AND EXISTS (
      SELECT 1 FROM public.properties prop
      WHERE prop.realtor_id = p.id
    );
$function$;

CREATE OR REPLACE FUNCTION public.get_renter_profile_for_realtor(renter_id uuid)
RETURNS TABLE(id uuid, name text, bio text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
  -- Only return basic info if the requesting realtor has a match with this renter
  SELECT p.id, p.name, COALESCE(p.bio, '') as bio
  FROM public.profiles p
  WHERE p.id = renter_id
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.property_matches m
      WHERE m.renter_id = renter_id 
        AND m.realtor_id = auth.uid()
    );
$function$;

CREATE OR REPLACE FUNCTION public.get_realtor_contact_for_renter(realtor_id uuid)
RETURNS TABLE(id uuid, name text, email text, phone text, bio text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
  -- Only return contact info if contact sharing is allowed AND there's a match
  SELECT 
    p.id, 
    p.name, 
    CASE WHEN p.allow_contact_sharing THEN p.email ELSE '' END as email,
    CASE WHEN p.allow_contact_sharing THEN COALESCE(p.phone, '') ELSE '' END as phone,
    COALESCE(p.bio, '') as bio
  FROM public.profiles p
  WHERE p.id = realtor_id
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.property_matches m
      WHERE m.realtor_id = realtor_id 
        AND m.renter_id = auth.uid()
    );
$function$;

CREATE OR REPLACE FUNCTION public.get_realtor_matched_renter_contact(renter_id uuid)
RETURNS TABLE(id uuid, name text, email text, phone text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
  -- Only return contact info if contact sharing is allowed AND there's a match
  SELECT 
    p.id, 
    p.name, 
    CASE WHEN p.allow_contact_sharing THEN p.email ELSE '' END as email,
    CASE WHEN p.allow_contact_sharing THEN COALESCE(p.phone, '') ELSE '' END as phone
  FROM public.profiles p
  WHERE p.id = renter_id
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.property_matches m
      WHERE m.renter_id = renter_id 
        AND m.realtor_id = auth.uid()
    );
$function$;

CREATE OR REPLACE FUNCTION public.get_matched_public_profiles(user_ids uuid[])
RETURNS TABLE(id uuid, name text, avatar_url text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.get_user_subscription_status()
RETURNS TABLE(subscribed boolean, subscription_tier text, subscription_end timestamp with time zone)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $function$
BEGIN
  -- Return subscription status for authenticated user only
  IF auth.uid() IS NULL THEN
    RETURN QUERY SELECT false::boolean, 'free'::text, null::timestamptz;
    RETURN;
  END IF;
  
  RETURN QUERY
  SELECT s.subscribed, s.subscription_tier, s.subscription_end
  FROM public.subscribers s
  WHERE s.user_id = auth.uid();
  
  -- If no record found, return default values
  IF NOT FOUND THEN
    RETURN QUERY SELECT false::boolean, 'free'::text, null::timestamptz;
  END IF;
END;
$function$;

-- 4. Add input validation functions for sensitive data
CREATE OR REPLACE FUNCTION public.validate_email(email_input text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE STRICT
SECURITY DEFINER
SET search_path = 'public'
AS $function$
  SELECT email_input ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    AND length(email_input) <= 254;
$function$;

CREATE OR REPLACE FUNCTION public.validate_phone(phone_input text)
RETURNS boolean  
LANGUAGE sql
IMMUTABLE STRICT
SECURITY DEFINER
SET search_path = 'public'
AS $function$
  SELECT phone_input ~* '^\+?[1-9]\d{1,14}$'
    AND length(phone_input) BETWEEN 10 AND 15;
$function$;

-- 5. Add trigger for profile data validation
CREATE OR REPLACE FUNCTION public.validate_profile_data()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
BEGIN
  -- Validate email format if provided
  IF NEW.email IS NOT NULL AND NOT public.validate_email(NEW.email) THEN
    RAISE EXCEPTION 'Invalid email format';
  END IF;
  
  -- Validate phone format if provided
  IF NEW.phone IS NOT NULL AND NEW.phone != '' AND NOT public.validate_phone(NEW.phone) THEN
    RAISE EXCEPTION 'Invalid phone number format';
  END IF;
  
  -- Sanitize name input (prevent XSS)
  IF NEW.name IS NOT NULL THEN
    NEW.name = regexp_replace(NEW.name, '[<>\"''&]', '', 'g');
    NEW.name = trim(NEW.name);
  END IF;
  
  -- Sanitize bio input
  IF NEW.bio IS NOT NULL THEN
    NEW.bio = regexp_replace(NEW.bio, '[<>\"''&]', '', 'g');
    NEW.bio = trim(NEW.bio);
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Create the trigger
DROP TRIGGER IF EXISTS validate_profile_trigger ON public.profiles;
CREATE TRIGGER validate_profile_trigger
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_profile_data();

-- 6. Add audit logging for sensitive operations
CREATE TABLE IF NOT EXISTS public.security_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  action text NOT NULL,
  table_name text NOT NULL,
  record_id uuid,
  old_values jsonb,
  new_values jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on audit log
ALTER TABLE public.security_audit_log ENABLE ROW LEVEL SECURITY;

-- Only allow administrators to read audit logs  
CREATE POLICY "Admin only audit log access"
ON public.security_audit_log
FOR ALL
USING (false);  -- No one can access by default, only via security definer functions

-- Create audit function for profile changes
CREATE OR REPLACE FUNCTION public.audit_profile_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    INSERT INTO public.security_audit_log (user_id, action, table_name, record_id, old_values, new_values)
    VALUES (
      auth.uid(),
      'UPDATE',
      'profiles',
      NEW.id,
      to_jsonb(OLD),
      to_jsonb(NEW)
    );
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO public.security_audit_log (user_id, action, table_name, record_id, new_values)
    VALUES (
      auth.uid(),
      'INSERT', 
      'profiles',
      NEW.id,
      to_jsonb(NEW)
    );
  END IF;
  
  RETURN NULL;
END;
$function$;

-- Create audit trigger for profiles
DROP TRIGGER IF EXISTS audit_profile_changes_trigger ON public.profiles;
CREATE TRIGGER audit_profile_changes_trigger
  AFTER INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_profile_changes();