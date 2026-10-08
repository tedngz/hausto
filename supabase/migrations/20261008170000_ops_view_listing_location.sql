-- The listing's location on the ops view, so a message to an agent can name
-- the unit by its building or street instead of our English title
-- (_shared/realtor/unit.ts). An agent asked "Căn chic urban là gì z ạ" on
-- 2026-10-08, chased about "Chic Urban Retreat in Lavida Plus with Modern
-- Elegance" with no link.
--
-- The live definition (2026-10-08) with listing_location appended: CREATE OR
-- REPLACE VIEW may add columns only at the end, and keeps the view's grants
-- when it does. security_invoker is restated so it is not lost.
--
-- No grant needed: `location` is already granted to authenticated (a public
-- listing fact, served by public-property-search), which the security_invoker
-- view needs - see 20260912130000_ops_view_column_grants.sql.

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
    ep.area_sqm,
    ep.location AS listing_location
   FROM public.request_items ri
     JOIN public.viewing_requests vr ON vr.id = ri.request_id
     LEFT JOIN public.realtors r ON r.id = ri.realtor_id
     LEFT JOIN public.external_properties ep ON ep.id = ri.listing_id;
