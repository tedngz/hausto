
DROP POLICY IF EXISTS "Authenticated users can manage their subscription" ON public.subscribers;

CREATE POLICY "Users can view their own subscription"
ON public.subscribers
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);
