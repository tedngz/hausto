
-- Restrict access to contact_name and contact_phone on external_properties.
-- Regular authenticated clients no longer see these columns via PostgREST.
-- Admins and matched renters retrieve them through a SECURITY DEFINER RPC.

REVOKE SELECT (contact_name, contact_phone) ON public.external_properties FROM anon;
REVOKE SELECT (contact_name, contact_phone) ON public.external_properties FROM authenticated;
-- service_role retains full access (used by edge functions)

CREATE OR REPLACE FUNCTION public.get_external_property_contact(_property_id uuid)
RETURNS TABLE(contact_name text, contact_phone text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ep.contact_name, ep.contact_phone
  FROM public.external_properties ep
  WHERE ep.id = _property_id
    AND auth.uid() IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'admin')
      OR EXISTS (
        SELECT 1 FROM public.property_matches m
        WHERE m.property_id = _property_id
          AND m.property_type = 'external'
          AND m.renter_id = auth.uid()
      )
    );
$$;

REVOKE ALL ON FUNCTION public.get_external_property_contact(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_external_property_contact(uuid) TO authenticated, service_role;

-- Batch variant for match list enrichment
CREATE OR REPLACE FUNCTION public.get_external_property_contacts(_property_ids uuid[])
RETURNS TABLE(id uuid, contact_name text, contact_phone text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ep.id, ep.contact_name, ep.contact_phone
  FROM public.external_properties ep
  WHERE ep.id = ANY(_property_ids)
    AND auth.uid() IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'admin')
      OR EXISTS (
        SELECT 1 FROM public.property_matches m
        WHERE m.property_id = ep.id
          AND m.property_type = 'external'
          AND m.renter_id = auth.uid()
      )
    );
$$;

REVOKE ALL ON FUNCTION public.get_external_property_contacts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_external_property_contacts(uuid[]) TO authenticated, service_role;
