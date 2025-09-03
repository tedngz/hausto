-- Security Enhancement Migration - Fixed
-- Phase 1: Critical Data Protection

-- 1. Enhance Profile Data Security
-- Drop existing policies first
DROP POLICY IF EXISTS "Users can view their own complete profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update only their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert only their own profile" ON public.profiles;

-- Create more granular policies for profile access
CREATE POLICY "Users can view their own profile data" 
ON public.profiles 
FOR SELECT 
USING (auth.uid() = id AND auth.uid() IS NOT NULL);

CREATE POLICY "Users can update their own profile securely" 
ON public.profiles 
FOR UPDATE 
USING (auth.uid() = id AND auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() = id AND auth.uid() IS NOT NULL);

CREATE POLICY "Users can insert their own profile securely" 
ON public.profiles 
FOR INSERT 
WITH CHECK (auth.uid() = id AND auth.uid() IS NOT NULL);

-- Add policy to prevent profile deletion (security measure)
CREATE POLICY "Prevent profile deletion" 
ON public.profiles 
FOR DELETE 
USING (false);

-- 2. Enhance Subscribers Table Security
-- Drop existing policies first
DROP POLICY IF EXISTS "Users can only view their own subscription data" ON public.subscribers;
DROP POLICY IF EXISTS "Users can only update their own subscription data" ON public.subscribers;
DROP POLICY IF EXISTS "Users can only insert their own subscription data" ON public.subscribers;

-- Add comprehensive RLS policy for subscribers table
CREATE POLICY "Strict subscriber access control" 
ON public.subscribers 
FOR ALL 
USING (auth.uid() = user_id AND auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() = user_id AND auth.uid() IS NOT NULL);

-- 3. Add input validation functions for sensitive data
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

-- 4. Add trigger for profile data validation and sanitization
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

-- Create the validation trigger
DROP TRIGGER IF EXISTS validate_profile_trigger ON public.profiles;
CREATE TRIGGER validate_profile_trigger
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_profile_data();

-- 5. Add audit logging for sensitive operations
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
USING (false);

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