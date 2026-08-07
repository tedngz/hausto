-- contact_phone / contact_name are deliberately excluded from the SELECT grants
-- on external_properties, so anon and authenticated cannot read them directly;
-- access goes through get_external_property_contacts, which requires an admin
-- or the matched renter. But raw_data IS readable, and the crawler was storing
-- up to 50KB of scraped page text in it - text that carries the agent's phone
-- number. An anonymous caller could read the very data the column grants
-- protect, just from a different column.
--
-- Strip the page text from every row. raw_data is crawler scratch space whose
-- only durable purpose is the image-recovery anchor, so nothing is lost.

UPDATE public.external_properties
SET raw_data = raw_data - 'markdown' - 'html' - 'description' - 'contact_phone' - 'contact_name'
WHERE raw_data IS NOT NULL
  AND (raw_data ? 'markdown' OR raw_data ? 'html' OR raw_data ? 'description'
       OR raw_data ? 'contact_phone' OR raw_data ? 'contact_name');

-- Defence in depth on the write side. There is no INSERT policy on this table
-- and UPDATE is admin-only, so RLS already blocks anonymous writes - but the
-- column grants were left wide open, and a future permissive policy would make
-- them live. Crawlers write with the service role, which is unaffected.
-- authenticated keeps UPDATE because the admin dashboard edits listings
-- through it, gated by the admin policy.
REVOKE INSERT, UPDATE, REFERENCES ON public.external_properties FROM anon;
REVOKE INSERT, REFERENCES ON public.external_properties FROM authenticated;
REVOKE UPDATE (contact_name, contact_phone) ON public.external_properties FROM authenticated;

-- Nothing anonymous needs the crawler's scratch space.
REVOKE SELECT (raw_data) ON public.external_properties FROM anon;
