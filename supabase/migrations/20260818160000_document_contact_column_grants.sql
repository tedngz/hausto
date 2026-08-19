-- Documentation only - no privilege or policy changes.
--
-- A security advisor flagged external_properties as exposing contact_phone and
-- contact_name to anonymous visitors, reasoning from the RLS policy "Anyone can
-- view active external properties by direct link" (USING is_active = true).
-- That policy is real, and it is not the whole story: RLS decides which ROWS a
-- caller may see, column GRANTs decide which COLUMNS. anon and authenticated
-- hold no table-wide SELECT on this table at all - only per-column grants that
-- omit the two contact columns - so the read fails with 42501 before RLS is
-- consulted. Contacts are released through get_external_property_contacts(),
-- which names who is entitled.
--
-- The reason this is worth a comment rather than nothing: the protection lives
-- entirely in column-level grants, which are invisible in the table definition
-- and trivially undone by a future `GRANT SELECT ON public.external_properties
-- TO anon` - a one-liner that looks harmless and would silently re-expose both
-- columns. The same applies to properties.property_source_provider_*, gated the
-- same way by 20260807050000_gate_internal_property_contacts.sql.
--
-- Note that adding a new column to this table fails safe: with no table-wide
-- grant to inherit, a new column starts unreadable by anon and authenticated
-- until it is granted explicitly.

COMMENT ON COLUMN public.external_properties.contact_phone IS
  'Restricted: no SELECT grant to anon/authenticated. Released only via get_external_property_contacts(). Do not GRANT SELECT on this table to anon or authenticated - that would re-expose this column.';

COMMENT ON COLUMN public.external_properties.contact_name IS
  'Restricted: no SELECT grant to anon/authenticated. Released only via get_external_property_contacts(). Do not GRANT SELECT on this table to anon or authenticated - that would re-expose this column.';
