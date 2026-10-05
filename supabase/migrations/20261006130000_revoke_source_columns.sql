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

REVOKE SELECT (source_url, raw_data) ON public.external_properties FROM anon, authenticated;
