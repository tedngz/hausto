-- DO block to merge duplicate conversations per renter/realtor into a single canonical conversation
DO $$
DECLARE
  dup RECORD;
  canon_id uuid;
BEGIN
  -- For each duplicate set, pick the earliest conversation as canonical
  FOR dup IN
    WITH numbered AS (
      SELECT id, renter_id, realtor_id, created_at,
             row_number() OVER (PARTITION BY renter_id, realtor_id ORDER BY created_at ASC, id ASC) AS rn
      FROM public.match_conversations
    )
    SELECT renter_id, realtor_id, array_agg(id ORDER BY rn) AS all_ids
    FROM numbered
    GROUP BY renter_id, realtor_id
    HAVING count(*) > 1
  LOOP
    -- First ID in array is the canonical one
    canon_id := dup.all_ids[1];
    
    -- Re-point all messages from duplicate conversations to canonical
    UPDATE public.direct_messages
    SET conversation_id = canon_id
    WHERE conversation_id = ANY(dup.all_ids[2:]);
    
    -- Delete duplicate conversations (keep only the first one)
    DELETE FROM public.match_conversations
    WHERE id = ANY(dup.all_ids[2:]);
  END LOOP;
END $$;

-- Now enforce uniqueness per renter/realtor
CREATE UNIQUE INDEX IF NOT EXISTS match_conversations_unique_pair
ON public.match_conversations (renter_id, realtor_id);