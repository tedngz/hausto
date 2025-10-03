-- Drop the existing restrictive INSERT policy
DROP POLICY IF EXISTS "Users can send messages in their conversations" ON public.direct_messages;

-- Create a more permissive INSERT policy that properly checks conversation membership
CREATE POLICY "Users can send messages in their conversations"
ON public.direct_messages
FOR INSERT
WITH CHECK (
  auth.uid() = sender_id
  AND EXISTS (
    SELECT 1
    FROM public.match_conversations mc
    WHERE mc.id = conversation_id
    AND (mc.renter_id = auth.uid() OR mc.realtor_id = auth.uid())
  )
);