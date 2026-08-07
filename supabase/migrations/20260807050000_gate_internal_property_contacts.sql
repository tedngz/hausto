-- Internal listings carried the same gap crawled ones had before their contact
-- columns were locked down: any signed-in user could read
-- property_source_provider_name / property_source_provider_phone straight from
-- the properties table, because the SELECT policy admits every authenticated
-- user to every active listing and the column grants were unrestricted.
--
-- Same treatment as external_properties: revoke the columns, and release them
-- through a SECURITY DEFINER function that names who is entitled. The rule
-- mirrors get_external_property_contacts, plus the owning realtor - a realtor
-- must always see the source contact on their own listing.

CREATE OR REPLACE FUNCTION public.get_property_contacts(_property_ids uuid[])
RETURNS TABLE(
  id uuid,
  property_source_provider_name text,
  property_source_provider_phone text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.property_source_provider_name, p.property_source_provider_phone
  FROM public.properties p
  WHERE p.id = ANY(_property_ids)
    AND auth.uid() IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'admin')
      OR p.realtor_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.property_matches m
        WHERE m.property_id = p.id
          AND m.property_type = 'internal'
          AND m.renter_id = auth.uid()
      )
    );
$$;

REVOKE ALL ON FUNCTION public.get_property_contacts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_property_contacts(uuid[]) TO authenticated;

-- anon never had SELECT here; authenticated loses direct access to the two
-- contact columns and goes through the function above. A column-level REVOKE
-- cannot carve a hole in a table-level grant, so the table grant is dropped
-- and the readable columns are granted back by name - the same shape as
-- external_properties. The browser now selects an explicit column list
-- (src/lib/propertyColumns.ts), so no select('*') is left to break.
REVOKE SELECT ON public.properties FROM authenticated;

GRANT SELECT (
  id, realtor_id, title, description, location, price, size, vibe, highlights,
  images, created_at, updated_at, vibe_analysis, property_source_link,
  amenities, is_active, last_activated_at, latitude, longitude, rooms
) ON public.properties TO authenticated;
