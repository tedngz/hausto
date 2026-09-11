-- external_properties is granted per COLUMN, not per table.
--
-- anon holds SELECT on 34 named columns and deliberately not on `contact_phone`,
-- `contact_name`, `raw_data` or `image_hashes` - the public can read a listing
-- without reading the broker's details. That is a good design and this keeps it.
--
-- The consequence nobody warns you about: a column added later is invisible to
-- the app, because ADD COLUMN grants nothing. Every canonical column from S3,
-- plus the identity and freshness columns, landed that way - and the symptom is
-- not a missing field but
--
--   401  {"code":"42501","message":"permission denied for table external_properties"}
--
-- a table-level error for a column-level problem, on a table the caller can
-- otherwise read perfectly well.
--
-- So the grant is explicit and the split is the point: facts a renter sees, yes;
-- anything that identifies a broker or describes our own bookkeeping, no.

-- Display facts. These are what a renter filters and chooses on.
GRANT SELECT (
  price_vnd,
  price_confidence,
  bedrooms,
  bedrooms_is_min,
  area_sqm,
  district_code
) ON public.external_properties TO anon, authenticated;

-- NOT granted, and each for its own reason:
--
--   contact_phone_e164   a phone number. anon cannot read contact_phone either,
--                        and a generated column is not a loophole in that.
--   realtor_id           identifies a broker. Invariant 4 keeps realtor identity
--                        off renter-facing surfaces.
--   source_agent_id      same.
--   delisted_at          our bookkeeping about why a listing went away.
--   price_confirmed_at   our bookkeeping about how fresh we think it is.
--
-- The ops console reads those with the `ops` role in S5, and edge functions
-- reach them with the service role, which holds all 52 columns.
