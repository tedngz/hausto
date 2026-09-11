-- 20260911140000 revoked UPDATE and DELETE on events to make it append-only,
-- and left TRUNCATE granted. Supabase grants the full set to anon,
-- authenticated and service_role by default, so the log could still be erased
-- wholesale by any of them - a weaker guarantee than the one the migration
-- claimed, and a worse failure than a row-level delete because it takes
-- everything and leaves nothing to notice.
--
-- Checked against the catalog rather than assumed:
--
--   service_role  INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE
--
-- `postgres` keeps everything and cannot usefully be revoked from - it owns the
-- table and migrations run as it. That is the trusted path; the point is that
-- no application role can reach it.
REVOKE TRUNCATE ON public.events FROM PUBLIC, anon, authenticated, service_role;

-- The other tables in the domain are ordinary mutable state, but nothing should
-- be truncating any of them from application code either.
REVOKE TRUNCATE ON
  public.renters,
  public.viewing_requests,
  public.request_items,
  public.messages,
  public.jobs
FROM PUBLIC, anon, authenticated, service_role;
