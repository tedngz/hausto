-- First, remove duplicate conversations by keeping only the most recent one per renter-realtor pair
WITH ranked_conversations AS (
  SELECT 
    id,
    renter_id,
    realtor_id,
    ROW_NUMBER() OVER (
      PARTITION BY renter_id, realtor_id 
      ORDER BY last_message_at DESC NULLS LAST, created_at DESC
    ) as rn
  FROM match_conversations
),
duplicates_to_delete AS (
  SELECT id 
  FROM ranked_conversations 
  WHERE rn > 1
)
DELETE FROM match_conversations 
WHERE id IN (SELECT id FROM duplicates_to_delete);

-- Add unique constraint to prevent future duplicates
ALTER TABLE match_conversations 
DROP CONSTRAINT IF EXISTS match_conversations_renter_realtor_unique;

ALTER TABLE match_conversations 
ADD CONSTRAINT match_conversations_renter_realtor_unique 
UNIQUE (renter_id, realtor_id);