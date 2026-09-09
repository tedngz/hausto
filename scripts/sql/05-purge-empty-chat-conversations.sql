-- Purge conversations that never held a message.
--
-- 165,534 of 165,950 rows - 99.7% - were empty, and 165,613 of them were
-- created in September 2025 by seven users. That is a runaway from a year ago,
-- not usage: normal months since run 20-60 conversations. The table is the
-- Hausto Agent's history and is still live, so it is cleaned rather than
-- dropped.
--
-- A conversation row is created before the first message is saved, so an empty
-- one is a thread that was opened and never spoken in. Nothing reads them - the
-- sidebar lists conversations, and an empty one is a blank entry - so deleting
-- them loses no content.
--
-- Run repeatedly until it reports 0 rows: one 165k-row delete is a long
-- transaction against the Management API and there is no need for it to be
-- atomic. Safe to re-run at any time.

WITH doomed AS (
  SELECT c.id
  FROM public.chat_conversations c
  WHERE NOT EXISTS (
    SELECT 1 FROM public.chat_messages m WHERE m.conversation_id = c.id
  )
  LIMIT 50000
)
DELETE FROM public.chat_conversations
WHERE id IN (SELECT id FROM doomed);
