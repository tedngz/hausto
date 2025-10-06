-- Drop old triggers and functions that reference match_id
DROP TRIGGER IF EXISTS update_match_conversation_on_new_message ON public.direct_messages;
DROP FUNCTION IF EXISTS public.update_or_create_match_conversation() CASCADE;

-- Drop match_id columns if they still exist (safe with IF EXISTS)
ALTER TABLE public.direct_messages DROP COLUMN IF EXISTS match_id CASCADE;
ALTER TABLE public.match_conversations DROP COLUMN IF EXISTS match_id CASCADE;

-- Create a simpler trigger to update conversation timestamps
CREATE OR REPLACE FUNCTION public.update_conversation_on_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.match_conversations
  SET 
    last_message_at = NEW.created_at,
    last_message_preview = LEFT(NEW.content, 100),
    updated_at = NOW()
  WHERE id = NEW.conversation_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for updating conversation on new message
DROP TRIGGER IF EXISTS update_conversation_on_new_message ON public.direct_messages;
CREATE TRIGGER update_conversation_on_new_message
  AFTER INSERT ON public.direct_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_conversation_on_message();