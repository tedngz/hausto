
-- Restrict direct SELECT on contact_name / contact_phone columns.
-- Access to these fields must go through get_external_property_contact(s),
-- which enforces admin-or-matched-renter authorization.
REVOKE SELECT ON public.external_properties FROM authenticated;
REVOKE SELECT ON public.external_properties FROM anon;

GRANT SELECT (
  id, external_id, source, source_url, title, location, location_normalized,
  city, price, price_display, size, description, highlights, amenities, images,
  vibe, vibe_analysis, crawled_at, expires_at, last_verified_at, is_active,
  created_at, updated_at, latitude, longitude, rooms, verification_failures,
  last_verification_status, last_verification_reason, deactivated_at,
  phone_extraction_attempts, vibe_status, raw_only, raw_data
) ON public.external_properties TO authenticated;

GRANT SELECT (
  id, external_id, source, source_url, title, location, location_normalized,
  city, price, price_display, size, description, highlights, amenities, images,
  vibe, vibe_analysis, crawled_at, expires_at, last_verified_at, is_active,
  created_at, updated_at, latitude, longitude, rooms, verification_failures,
  last_verification_status, last_verification_reason, deactivated_at,
  phone_extraction_attempts, vibe_status, raw_only, raw_data
) ON public.external_properties TO anon;
