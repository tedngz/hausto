-- Applied directly to production at 2026-10-22 10:46 UTC, outside any branch;
-- this file records it so `supabase db push` stops failing with "Remote migration
-- versions not found in local migrations directory" (run 40301647834, the merge
-- of #227). The statements are the ones stored in
-- supabase_migrations.schema_migrations for this version, unchanged: a
-- CREATE OR REPLACE and a REVOKE, so a replay is harmless.

-- Listings linked to a realtor but still carrying a masked/blank contact_phone have
-- contact_phone_e164 = NULL, so reveal_listing_contact answers 'no_number'.
-- Copy the realtor's verified number onto those listings. Idempotent; the
-- snapshot trigger keeps the old masked value in external_property_snapshots.
CREATE OR REPLACE FUNCTION public.sync_listing_phones_from_realtors()
RETURNS TABLE(listing_id uuid, phone_e164 text)
LANGUAGE sql
SET search_path TO 'public'
AS $function$
  UPDATE public.external_properties ep
  SET contact_phone = '0' || substring(r.phone_e164 from 4),
      updated_at = now()
  FROM public.realtors r
  WHERE ep.realtor_id = r.id
    AND ep.contact_phone_e164 IS NULL
    AND r.phone_e164 ~ '^\+84[0-9]{9}$'
  RETURNING ep.id, r.phone_e164;
$function$;

REVOKE ALL ON FUNCTION public.sync_listing_phones_from_realtors() FROM PUBLIC, anon, authenticated;
