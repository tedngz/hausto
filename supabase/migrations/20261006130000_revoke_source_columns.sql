-- Renters stop reading a crawled listing's source link and raw_data from the
-- table (pricing rework, build step 1, the query-layer half).
--
-- MERGE ONLY AFTER the renter app from #156 is published from Lovable. The
-- app live before that publish still selects source_url on every browse and
-- property-page query, and a column it may not read fails the whole query.
--
-- The source ad carries the agent's number, so the link is the agent's number
-- one click away (CLAUDE.md invariant 4). #156 stopped every renter surface
-- asking for it and moved the admin screens to admin_external_listing_sources;
-- this takes away the grant, so the anon key cannot read it either. raw_data
-- holds source links too (120 of 180 active rows on 2026-10-06).
--
-- Both grants are column-level (there is no table-level SELECT for these
-- roles), so a column revoke removes them. UPDATE stays: admins edit source_url
-- from the console without reading it back. Idempotent: revoking a privilege
-- that is not held is a no-op.

-- ── The ops view first ──────────────────────────────────────────────────────
-- ops_request_items_view is security_invoker, so whoever reads it needs the
-- column it names. The ops console reads it as `authenticated` (an ops user),
-- so taking source_url from that role would break every request page; and a
-- renter, whom RLS lets read their own request items, could read their
-- listings' source links through it today. So listing_url now comes from a
-- function that answers ops, admins and the service role - the AI operator's
-- planner puts the link in its drafts to agents - and nobody else.
CREATE OR REPLACE FUNCTION public.ops_listing_url(_listing_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ep.source_url
  FROM public.external_properties ep
  WHERE ep.id = _listing_id
    AND (
      auth.role() = 'service_role'
      OR public.has_role(auth.uid(), 'ops'::app_role)
      OR public.has_role(auth.uid(), 'admin'::app_role)
    );
$function$;

REVOKE ALL ON FUNCTION public.ops_listing_url(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_listing_url(uuid) TO authenticated, service_role;

-- The live definition (2026-10-06), with listing_url through the function.
-- Same columns, names and types in the same order, so CREATE OR REPLACE
-- keeps the view's grants; security_invoker is restated so it is not lost.
CREATE OR REPLACE VIEW public.ops_request_items_view WITH (security_invoker = true) AS
 SELECT ri.id,
    ri.request_id,
    vr.ref AS request_ref,
    ri.listing_id,
    ri.realtor_id,
    ri.price_vnd_at_request,
    ri.sort_order,
    ri.created_at,
    r.phone_e164 AS realtor_phone,
    r.display_name AS realtor_name,
    ep.title AS listing_title,
    public.ops_listing_url(ri.listing_id) AS listing_url,
    ep.district_code,
    ep.bedrooms,
    ep.area_sqm
   FROM public.request_items ri
     JOIN public.viewing_requests vr ON vr.id = ri.request_id
     LEFT JOIN public.realtors r ON r.id = ri.realtor_id
     LEFT JOIN public.external_properties ep ON ep.id = ri.listing_id;

-- ── Then the grants ─────────────────────────────────────────────────────────
REVOKE SELECT (source_url, raw_data) ON public.external_properties FROM anon, authenticated;
