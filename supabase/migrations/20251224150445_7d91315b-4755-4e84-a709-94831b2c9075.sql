-- Drop existing function and recreate with new return type
DROP FUNCTION IF EXISTS public.get_renter_profile_for_realtor(uuid);

CREATE FUNCTION public.get_renter_profile_for_realtor(renter_id uuid)
 RETURNS TABLE(id uuid, name text, bio text, avatar_url text, email text, phone text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Only return info if the requesting realtor has a match with this renter
  SELECT 
    p.id, 
    p.name, 
    COALESCE(p.bio, '') as bio,
    p.avatar_url,
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
