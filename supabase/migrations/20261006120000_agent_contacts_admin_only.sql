-- Agent contacts and source links leave the database for admins only
-- (pricing rework, build step 1). Replay-safe: CREATE OR REPLACE throughout.
--
-- Until now a renter matched to a listing could read its agent's name and
-- number from these functions, and matching is free and unlimited - the
-- property page loaded the number without showing it. The Pass now sells
-- viewings that happen, never the agent's number, and the one path to an
-- agent's number is the viewing-day message, on the day of a viewing the
-- renter kept, with the agent's consent (CLAUDE.md invariant 4, `dayStops` in
-- _shared/viewing/viewing-day.ts). Opening these on the viewing day as well
-- would be a second path, so they do not open for renters at all.
--
-- Same signatures and return shapes as before, so every caller keeps working:
-- a renter's call now returns no rows, which every caller already reads as
-- "no contact on file".

CREATE OR REPLACE FUNCTION public.get_external_property_contacts(_property_ids uuid[])
 RETURNS TABLE(id uuid, contact_name text, contact_phone text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ep.id, ep.contact_name, ep.contact_phone
  FROM public.external_properties ep
  WHERE ep.id = ANY(_property_ids)
    AND auth.uid() IS NOT NULL
    AND public.has_role(auth.uid(), 'admin');
$function$;

CREATE OR REPLACE FUNCTION public.get_external_property_contact(_property_id uuid)
 RETURNS TABLE(contact_name text, contact_phone text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ep.contact_name, ep.contact_phone
  FROM public.external_properties ep
  WHERE ep.id = _property_id
    AND auth.uid() IS NOT NULL
    AND public.has_role(auth.uid(), 'admin');
$function$;

-- A realtor's own listings stay readable to that realtor, who typed the
-- contact in. A matched renter no longer reads them, for the same reason.
CREATE OR REPLACE FUNCTION public.get_property_contacts(_property_ids uuid[])
 RETURNS TABLE(id uuid, property_source_provider_name text, property_source_provider_phone text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.property_source_provider_name, p.property_source_provider_phone
  FROM public.properties p
  WHERE p.id = ANY(_property_ids)
    AND auth.uid() IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'admin')
      OR p.realtor_id = auth.uid()
    );
$function$;

-- The source link and the crawler's scratch space, for the admin screens.
--
-- Both are columns any signed-in user (and, for source_url, any visitor) can
-- read today through the table grants. The admin screens are the only
-- readers that need them, so they move to this function, and a follow-up
-- migration revokes the column grants once the renter app that stops
-- selecting them has been published from Lovable - revoking first would
-- break every browse query still asking for source_url.
CREATE OR REPLACE FUNCTION public.admin_external_listing_sources(_ids uuid[])
 RETURNS TABLE(id uuid, source_url text, raw_data jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ep.id, ep.source_url, ep.raw_data
  FROM public.external_properties ep
  WHERE ep.id = ANY(_ids)
    AND auth.uid() IS NOT NULL
    AND public.has_role(auth.uid(), 'admin');
$function$;

REVOKE ALL ON FUNCTION public.admin_external_listing_sources(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_external_listing_sources(uuid[]) TO authenticated;
