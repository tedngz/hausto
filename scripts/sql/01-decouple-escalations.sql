-- Step 1 of retiring the chat: let concierge_escalations stand on its own.
--
-- Escalations currently hang off a chat conversation (conversation_id is NOT
-- NULL and CASCADEs from match_conversations), so dropping the chat tables
-- would silently delete every escalation. This mirrors the decoupling already
-- done for fast_track_requests: nullable conversation/realtor plus a `source`.
--
-- Run: bash scripts/supabase-sql.sh scripts/sql/01-decouple-escalations.sql
BEGIN;

ALTER TABLE concierge_escalations
  DROP CONSTRAINT IF EXISTS concierge_escalations_conversation_id_fkey,
  DROP CONSTRAINT IF EXISTS concierge_escalations_source_message_id_fkey,
  DROP CONSTRAINT IF EXISTS concierge_escalations_answered_message_id_fkey,
  ALTER COLUMN conversation_id DROP NOT NULL,
  ALTER COLUMN realtor_id      DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'chat';

COMMIT;

-- PostgREST caches the schema; without this the new column 404s.
NOTIFY pgrst, 'reload schema';
