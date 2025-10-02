-- Deduplicate conversations by renter-realtor pair and enforce uniqueness
DO $$
DECLARE
  duplicate_pair RECORD;
  keep_conv_id uuid;
  delete_conv_ids uuid[];
BEGIN
  -- Find all duplicate renter-realtor pairs
  FOR duplicate_pair IN
    SELECT renter_id, realtor_id, COUNT(*) as cnt
    FROM public.match_conversations
    GROUP BY renter_id, realtor_id
    HAVING COUNT(*) > 1
  LOOP
    -- Get the earliest conversation to keep (based on created_at)
    SELECT id INTO keep_conv_id
    FROM public.match_conversations
    WHERE renter_id = duplicate_pair.renter_id 
      AND realtor_id = duplicate_pair.realtor_id
    ORDER BY created_at ASC
    LIMIT 1;

    -- Get all other conversation IDs to delete
    SELECT ARRAY_AGG(id) INTO delete_conv_ids
    FROM public.match_conversations
    WHERE renter_id = duplicate_pair.renter_id 
      AND realtor_id = duplicate_pair.realtor_id
      AND id != keep_conv_id;

    -- Move all messages from duplicate conversations to the kept one
    UPDATE public.direct_messages
    SET conversation_id = keep_conv_id
    WHERE conversation_id = ANY(delete_conv_ids);

    -- Delete the duplicate conversations
    DELETE FROM public.match_conversations
    WHERE id = ANY(delete_conv_ids);

    RAISE NOTICE 'Merged % duplicate conversations for renter % and realtor % into %', 
      duplicate_pair.cnt - 1, duplicate_pair.renter_id, duplicate_pair.realtor_id, keep_conv_id;
  END LOOP;

  -- Add unique constraint to prevent future duplicates
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_match_conversations_pair'
  ) THEN
    CREATE UNIQUE INDEX uq_match_conversations_pair
      ON public.match_conversations (renter_id, realtor_id);
  END IF;

  -- Ensure FK from direct_messages -> match_conversations (cascade on delete)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'direct_messages_conversation_id_fkey'
  ) THEN
    ALTER TABLE public.direct_messages
    ADD CONSTRAINT direct_messages_conversation_id_fkey
    FOREIGN KEY (conversation_id)
    REFERENCES public.match_conversations(id)
    ON DELETE CASCADE;
  END IF;
END $$;