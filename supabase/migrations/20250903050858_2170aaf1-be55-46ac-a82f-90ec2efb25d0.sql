-- Create INSERT policy for chat_messages table to fix RLS violation
CREATE POLICY "Authenticated users can create messages in their conversations" 
ON public.chat_messages 
FOR INSERT 
WITH CHECK (
  auth.uid() IS NOT NULL AND 
  EXISTS (
    SELECT 1 FROM public.chat_conversations 
    WHERE chat_conversations.id = chat_messages.conversation_id 
    AND chat_conversations.user_id = auth.uid()
  )
);

-- Also create INSERT policy for chat_conversations if missing
CREATE POLICY "Authenticated users can create their own conversations" 
ON public.chat_conversations 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);