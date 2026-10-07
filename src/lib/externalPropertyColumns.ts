// Columns of public.external_properties that are safe to expose to renters.
// Contact fields (contact_name, contact_phone, contact_phone_e164) and
// `source_url` are deliberately absent: the source posting carries the agent's
// number, and a renter gets it one way only - AgentContact, signed in,
// through `reveal_listing_contact` (CLAUDE.md invariant 4, SPEC §6).
// Admin screens read them through `get_external_property_contacts` and
// `admin_external_listing_sources`, which answer admins only.
//
// `raw_data` is absent too: it is the crawler's scratch space (source URLs for
// image recovery), and it rides along on every listing of every browse fetch.
//
// Adding a column here needs a migration too:
// `GRANT SELECT (<column>) ON public.external_properties TO anon, authenticated`.
// These roles have no table-level SELECT, only column grants, and one column
// they cannot read makes the whole query fail with a 403 - which is how
// is_relist and canonical_group_id emptied the building pages from 2026-08-18
// until 20261006170000.
export const EXTERNAL_PROPERTY_PUBLIC_COLUMNS =
  'id, external_id, source, title, location, location_normalized, city, price, price_display, size, description, highlights, amenities, images, vibe, vibe_analysis, crawled_at, last_verified_at, is_active, created_at, updated_at, latitude, longitude, rooms, verification_failures, last_verification_status, last_verification_reason, deactivated_at, phone_extraction_attempts, vibe_status, raw_only, is_relist, canonical_group_id';
