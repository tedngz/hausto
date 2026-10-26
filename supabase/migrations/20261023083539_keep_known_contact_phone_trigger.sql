-- Applied directly to production at 2026-10-23 08:35 UTC, outside any branch;
-- this file records it so `supabase db push` stops failing with "Remote migration
-- versions not found in local migrations directory" (run 40301647834, the merge
-- of #227). The statements are the ones stored in
-- supabase_migrations.schema_migrations for this version, with a
-- DROP TRIGGER IF EXISTS added before the CREATE so a replay is harmless.

SET lock_timeout = '20s';
DROP TRIGGER IF EXISTS trg_keep_known_contact_phone ON public.external_properties;
CREATE TRIGGER trg_keep_known_contact_phone
  BEFORE UPDATE OF contact_phone ON public.external_properties
  FOR EACH ROW EXECUTE FUNCTION public.keep_known_contact_phone();
