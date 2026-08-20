-- Step 2 of retiring the chat: drop the renter<->realtor messaging tables.
--
-- ONLY run this after 01-decouple-escalations.sql has been applied AND the
-- code no longer references these tables, or the live app will 500 on the
-- renter path (useMatches feeds the nav badge).
--
-- Contents at time of writing were test data: 5 conversations / 412 messages
-- across 5 accounts, the only "realtor" being Hausto Agent (the admin's own
-- address). fast_track_requests.conversation_id CASCADEs, so any rows there
-- pointing at a conversation go too - it was nullable and browse-sourced
-- requests are unaffected.
--
-- Run: bash scripts/supabase-sql.sh scripts/sql/02-drop-chat-tables.sql
BEGIN;

DROP TABLE IF EXISTS direct_messages CASCADE;
DROP TABLE IF EXISTS match_conversations CASCADE;

COMMIT;

NOTIFY pgrst, 'reload schema';
