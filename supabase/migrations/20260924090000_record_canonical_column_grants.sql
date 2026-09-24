-- Records a grant that was applied by hand and never committed.
--
-- On 2026-09-11, while diagnosing an empty request page, this was run directly
-- through scripts/supabase-sql.sh. It was part of #91, which was closed as
-- superseded by #92, so the migration never reached main - but the grant stayed
-- live. Production therefore held a privilege that no commit described.
--
-- This changes nothing in production. It exists so the migrations describe the
-- database as it actually is, which is the rule in CLAUDE.md for anything
-- applied by hand. GRANT is idempotent, so replaying it is harmless.
--
-- external_properties is granted per COLUMN: anon reads 34 named columns and
-- deliberately not contact_phone, contact_name or raw_data. A column added later
-- starts unreadable, and fails as a table-level 42501 rather than a missing
-- field. These six are display facts - price, size, bedrooms, district - that
-- are already public through the older free-text columns.
--
-- 20260912130000 records part of the authenticated half (district_code,
-- bedrooms, area_sqm, for the ops view). The rest, and all of the anon half,
-- were unrecorded until now.
GRANT SELECT (
  price_vnd,
  price_confidence,
  bedrooms,
  bedrooms_is_min,
  area_sqm,
  district_code
) ON public.external_properties TO anon, authenticated;

-- Deliberately still NOT granted to either role: contact_phone_e164,
-- realtor_id, source_agent_id, delisted_at, price_confirmed_at.
