-- Add function to ensure RLS policies work correctly for direct message deletions
-- and improve chat message deletion support

-- First, update the chat_messages table to support cascading deletes
ALTER TABLE chat_messages 
ADD CONSTRAINT chat_messages_conversation_id_fkey 
FOREIGN KEY (conversation_id) 
REFERENCES chat_conversations(id) 
ON DELETE CASCADE;

-- Update the direct_messages table to support cascading deletes
ALTER TABLE direct_messages 
ADD CONSTRAINT direct_messages_match_id_fkey 
FOREIGN KEY (match_id) 
REFERENCES property_matches(id) 
ON DELETE CASCADE;

-- Update the match_conversations table to support cascading deletes  
ALTER TABLE match_conversations 
ADD CONSTRAINT match_conversations_match_id_fkey 
FOREIGN KEY (match_id) 
REFERENCES property_matches(id) 
ON DELETE CASCADE;