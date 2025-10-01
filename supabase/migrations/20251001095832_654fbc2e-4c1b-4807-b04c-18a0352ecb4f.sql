-- Step 1: Drop existing RLS policies
DROP POLICY IF EXISTS "Authenticated users create match conversations" ON match_conversations;
DROP POLICY IF EXISTS "Authenticated users view match conversations" ON match_conversations;
DROP POLICY IF EXISTS "Authenticated users update match conversations" ON match_conversations;
DROP POLICY IF EXISTS "Authenticated users send messages" ON direct_messages;
DROP POLICY IF EXISTS "Authenticated users view match messages" ON direct_messages;
DROP POLICY IF EXISTS "Authenticated users update own messages" ON direct_messages;

-- Step 2: Add renter_id and realtor_id to match_conversations
ALTER TABLE match_conversations 
  ADD COLUMN IF NOT EXISTS renter_id uuid,
  ADD COLUMN IF NOT EXISTS realtor_id uuid;

-- Step 3: Populate renter_id and realtor_id from existing matches
UPDATE match_conversations mc
SET 
  renter_id = pm.renter_id,
  realtor_id = pm.realtor_id
FROM property_matches pm
WHERE mc.match_id = pm.id;

-- Step 4: Make the new columns NOT NULL
ALTER TABLE match_conversations 
  ALTER COLUMN renter_id SET NOT NULL,
  ALTER COLUMN realtor_id SET NOT NULL;

-- Step 5: Add conversation_id to direct_messages  
ALTER TABLE direct_messages 
  ADD COLUMN IF NOT EXISTS conversation_id uuid;

-- Step 6: Create a mapping table to identify the conversation to keep for each renter-realtor pair
CREATE TEMP TABLE conversation_mapping AS
SELECT DISTINCT ON (mc.renter_id, mc.realtor_id)
  mc.renter_id,
  mc.realtor_id,
  mc.id as keep_conversation_id,
  mc.match_id as keep_match_id
FROM match_conversations mc
ORDER BY mc.renter_id, mc.realtor_id, mc.created_at ASC;

-- Step 7: Update ALL messages to point to the kept conversation for their renter-realtor pair
UPDATE direct_messages dm
SET conversation_id = cm.keep_conversation_id
FROM property_matches pm
JOIN match_conversations mc_old ON mc_old.match_id = pm.id
JOIN conversation_mapping cm ON (cm.renter_id = pm.renter_id AND cm.realtor_id = pm.realtor_id)
WHERE dm.match_id = pm.id;

-- Step 8: Handle any remaining messages by directly matching to their conversation
UPDATE direct_messages dm
SET conversation_id = mc.id  
FROM match_conversations mc
WHERE dm.match_id = mc.match_id
AND dm.conversation_id IS NULL;

-- Step 9: Make conversation_id NOT NULL
ALTER TABLE direct_messages 
  ALTER COLUMN conversation_id SET NOT NULL;

-- Step 10: Add the foreign key constraint
ALTER TABLE direct_messages
  ADD CONSTRAINT direct_messages_conversation_id_fkey 
  FOREIGN KEY (conversation_id) REFERENCES match_conversations(id);

-- Step 11: Delete duplicate conversations (keeping only the earliest one per renter-realtor pair)
DELETE FROM match_conversations mc
WHERE NOT EXISTS (
  SELECT 1 FROM conversation_mapping cm
  WHERE cm.keep_conversation_id = mc.id
);

-- Step 12: Drop match_id columns
ALTER TABLE match_conversations DROP COLUMN IF EXISTS match_id CASCADE;
ALTER TABLE direct_messages DROP COLUMN IF EXISTS match_id CASCADE;

-- Step 13: Add unique constraint
ALTER TABLE match_conversations 
  ADD CONSTRAINT unique_renter_realtor UNIQUE (renter_id, realtor_id);

-- Step 14: Add foreign keys to auth.users
ALTER TABLE match_conversations
  ADD CONSTRAINT match_conversations_renter_id_fkey 
  FOREIGN KEY (renter_id) REFERENCES auth.users(id),
  ADD CONSTRAINT match_conversations_realtor_id_fkey 
  FOREIGN KEY (realtor_id) REFERENCES auth.users(id);

-- Step 15: Create new RLS policies for match_conversations
CREATE POLICY "Users can create conversations with their matches"
  ON match_conversations FOR INSERT
  WITH CHECK (
    auth.uid() = renter_id OR auth.uid() = realtor_id
  );

CREATE POLICY "Users can view their own conversations"
  ON match_conversations FOR SELECT
  USING (
    auth.uid() = renter_id OR auth.uid() = realtor_id
  );

CREATE POLICY "Users can update their own conversations"
  ON match_conversations FOR UPDATE
  USING (
    auth.uid() = renter_id OR auth.uid() = realtor_id
  );

-- Step 16: Create new RLS policies for direct_messages
CREATE POLICY "Users can send messages in their conversations"
  ON direct_messages FOR INSERT
  WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (
      SELECT 1 FROM match_conversations mc
      WHERE mc.id = direct_messages.conversation_id
      AND (mc.renter_id = auth.uid() OR mc.realtor_id = auth.uid())
    )
  );

CREATE POLICY "Users can view messages in their conversations"
  ON direct_messages FOR SELECT
  USING (
    auth.uid() = sender_id OR auth.uid() = receiver_id
  );

CREATE POLICY "Users can update their own messages"
  ON direct_messages FOR UPDATE
  USING (
    auth.uid() = sender_id
  );

-- Step 17: Create a view to get all matched properties for a conversation
CREATE OR REPLACE VIEW conversation_properties AS
SELECT 
  mc.id as conversation_id,
  mc.renter_id,
  mc.realtor_id,
  pm.id as match_id,
  pm.property_id,
  p.title,
  p.price,
  p.location,
  p.images,
  pm.created_at as matched_at
FROM match_conversations mc
JOIN property_matches pm ON (
  pm.renter_id = mc.renter_id AND 
  pm.realtor_id = mc.realtor_id
)
JOIN properties p ON p.id = pm.property_id
ORDER BY pm.created_at DESC;