-- Security Fix 1: Secure Properties Table - Require Authentication
DROP POLICY IF EXISTS "Anyone can view published properties" ON public.properties;

CREATE POLICY "Authenticated users can view published properties" 
ON public.properties 
FOR SELECT 
USING (auth.uid() IS NOT NULL);

-- Security Fix 2: Secure Posts Table - Require Authentication  
DROP POLICY IF EXISTS "Anyone can view posts" ON public.posts;

CREATE POLICY "Authenticated users can view posts" 
ON public.posts 
FOR SELECT 
USING (auth.uid() IS NOT NULL);

-- Security Fix 3: Database Function Hardening - Add missing search_path parameters
CREATE OR REPLACE FUNCTION public.get_post_like_count(post_uuid uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COUNT(*)::integer
  FROM public.post_likes
  WHERE post_id = post_uuid;
$function$;

CREATE OR REPLACE FUNCTION public.user_liked_post(post_uuid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.post_likes
    WHERE post_id = post_uuid 
      AND user_id = auth.uid()
  );
$function$;

CREATE OR REPLACE FUNCTION public.validate_email(email_input text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE STRICT SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT email_input ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    AND length(email_input) <= 254;
$function$;

CREATE OR REPLACE FUNCTION public.validate_phone(phone_input text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE STRICT SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT phone_input ~* '^\+?[1-9]\d{1,14}$'
    AND length(phone_input) BETWEEN 10 AND 15;
$function$;

CREATE OR REPLACE FUNCTION public.get_realtor_public_profile(realtor_id uuid)
 RETURNS TABLE(id uuid, name text, bio text, avatar_url text, location text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
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