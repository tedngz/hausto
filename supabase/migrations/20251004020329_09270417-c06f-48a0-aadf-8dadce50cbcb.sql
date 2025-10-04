-- Re-point messages from duplicate conversations to kept one
WITH ranked AS (
  SELECT 
    id,
    renter_id,
    realtor_id,
    created_at,
    ROW_NUMBER() OVER (PARTITION BY renter_id, realtor_id ORDER BY created_at ASC, id::text ASC) AS rn,
    FIRST_VALUE(id) OVER (PARTITION BY renter_id, realtor_id ORDER BY created_at ASC, id::text ASC) AS keep_id
  FROM public.match_conversations
),
dupes AS (
  SELECT id AS duplicate_id, keep_id
  FROM ranked
  WHERE rn > 1
)
UPDATE public.direct_messages dm
SET conversation_id = d.keep_id
FROM dupes d
WHERE dm.conversation_id = d.duplicate_id;

-- Delete duplicate conversations (separate CTE scope)
WITH ranked AS (
  SELECT 
    id,
    renter_id,
    realtor_id,
    created_at,
    ROW_NUMBER() OVER (PARTITION BY renter_id, realtor_id ORDER BY created_at ASC, id::text ASC) AS rn,
    FIRST_VALUE(id) OVER (PARTITION BY renter_id, realtor_id ORDER BY created_at ASC, id::text ASC) AS keep_id
  FROM public.match_conversations
),
dupes AS (
  SELECT id AS duplicate_id, keep_id
  FROM ranked
  WHERE rn > 1
)
DELETE FROM public.match_conversations mc
USING dupes d
WHERE mc.id = d.duplicate_id;