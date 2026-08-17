// Columns of public.external_properties that are safe to expose to authenticated
// users. Contact fields (contact_name, contact_phone) are intentionally excluded
// and must be fetched via the `get_external_property_contact(s)` RPC, which
// enforces match-based access.
//
// `raw_data` is deliberately absent: it is the crawler's scratch space (source
// URLs for image recovery) that nothing on the client reads, and it rides along
// on every listing of every browse fetch. Read it per-listing where needed.
export const EXTERNAL_PROPERTY_PUBLIC_COLUMNS =
  'id, external_id, source, source_url, title, location, location_normalized, city, price, price_display, size, description, highlights, amenities, images, vibe, vibe_analysis, crawled_at, last_verified_at, is_active, created_at, updated_at, latitude, longitude, rooms, verification_failures, last_verification_status, last_verification_reason, deactivated_at, phone_extraction_attempts, vibe_status, raw_only, is_relist, canonical_group_id';
