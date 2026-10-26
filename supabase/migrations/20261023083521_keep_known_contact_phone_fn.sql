-- Applied directly to production at 2026-10-23 08:35 UTC, outside any branch;
-- this file records it so `supabase db push` stops failing with "Remote migration
-- versions not found in local migrations directory" (run 40301647834, the merge
-- of #227). The statement is the one stored in
-- supabase_migrations.schema_migrations for this version, unchanged, and a
-- CREATE OR REPLACE, so a replay is harmless.
--
-- An update that would turn a dialable contact_phone into a masked or blank
-- one keeps the old number, unless the session sets hausto.allow_phone_clear.
-- 20261023083539_keep_known_contact_phone_trigger.sql attaches it.

CREATE OR REPLACE FUNCTION public.keep_known_contact_phone()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.contact_phone IS DISTINCT FROM OLD.contact_phone
     AND public.normalize_vn_phone(OLD.contact_phone) IS NOT NULL
     AND public.normalize_vn_phone(NEW.contact_phone) IS NULL
     AND coalesce(current_setting('hausto.allow_phone_clear', true), '') <> 'on'
  THEN
    NEW.contact_phone := OLD.contact_phone;
  END IF;
  RETURN NEW;
END;
$function$;
