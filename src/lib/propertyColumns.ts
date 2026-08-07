// Column list for reads of `properties` from the browser.
//
// `property_source_provider_name` / `property_source_provider_phone` are the
// source contact for a listing, and they are deliberately absent: the SELECT
// grant on those two columns is revoked for authenticated, so `select('*')`
// fails outright. Contact details are released by get_property_contacts, which
// hands them to an admin, the owning realtor, or the renter matched to that
// listing - the same rule get_external_property_contacts applies to crawled
// listings.
export const PROPERTY_PUBLIC_COLUMNS =
  'id, realtor_id, title, description, location, price, size, vibe, highlights, images, created_at, updated_at, vibe_analysis, property_source_link, amenities, is_active, last_activated_at, latitude, longitude, rooms';
