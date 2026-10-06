// Columns of public.external_properties that are safe to expose to renters.
// Contact fields (contact_name, contact_phone) and `source_url` are
// deliberately absent: the source posting carries the agent's number, and
// renters reach agents only through a viewing request (CLAUDE.md invariant 4).
// Admin screens read them through `get_external_property_contacts` and
// `admin_external_listing_sources`, which answer admins only.
//
// `raw_data` is absent too: it is the crawler's scratch space (source URLs for
// image recovery), and it rides along on every listing of every browse fetch.
export const EXTERNAL_PROPERTY_PUBLIC_COLUMNS =
  'id, external_id, source, title, location, location_normalized, city, price, price_display, size, description, highlights, amenities, images, vibe, vibe_analysis, crawled_at, last_verified_at, is_active, created_at, updated_at, latitude, longitude, rooms, verification_failures, last_verification_status, last_verification_reason, deactivated_at, phone_extraction_attempts, vibe_status, raw_only, is_relist, canonical_group_id';
