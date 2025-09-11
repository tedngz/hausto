-- Clean up empty conversations that have no messages
DELETE FROM public.chat_conversations 
WHERE id IN (
  SELECT c.id 
  FROM public.chat_conversations c 
  LEFT JOIN public.chat_messages m ON c.id = m.conversation_id 
  WHERE m.id IS NULL
);