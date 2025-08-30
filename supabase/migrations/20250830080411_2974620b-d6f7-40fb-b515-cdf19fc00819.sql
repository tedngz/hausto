-- Fix remaining security functions with proper search_path
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_conversation_on_new_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.match_conversations (match_id, last_message_at, last_message_preview)
  VALUES (NEW.match_id, NEW.created_at, LEFT(NEW.content, 100))
  ON CONFLICT (match_id) 
  DO UPDATE SET 
    last_message_at = NEW.created_at,
    last_message_preview = LEFT(NEW.content, 100),
    updated_at = now();
  
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.activate_user_subscription(user_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.subscribers (user_id, email, subscribed, subscription_tier, subscription_end, updated_at)
  VALUES (
    (SELECT id FROM auth.users WHERE email = user_email),
    user_email, 
    true, 
    'premium', 
    now() + interval '1 month', 
    now()
  )
  ON CONFLICT (email) 
  DO UPDATE SET 
    subscribed = true,
    subscription_tier = 'premium',
    subscription_end = now() + interval '1 month',
    updated_at = now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

-- Fix match_conversations policies to require authentication
DROP POLICY IF EXISTS "Users can view conversations from their matches" ON public.match_conversations;
DROP POLICY IF EXISTS "Users can create conversations for their matches" ON public.match_conversations; 
DROP POLICY IF EXISTS "Users can update conversations for their matches" ON public.match_conversations;

CREATE POLICY "Authenticated users can view conversations from their matches" 
ON public.match_conversations 
FOR SELECT 
USING (auth.uid() IS NOT NULL AND EXISTS ( 
  SELECT 1 FROM property_matches 
  WHERE property_matches.id = match_conversations.match_id 
    AND (property_matches.renter_id = auth.uid() OR property_matches.realtor_id = auth.uid())
));

CREATE POLICY "Authenticated users can create conversations for their matches" 
ON public.match_conversations 
FOR INSERT 
WITH CHECK (auth.uid() IS NOT NULL AND EXISTS ( 
  SELECT 1 FROM property_matches 
  WHERE property_matches.id = match_conversations.match_id 
    AND (property_matches.renter_id = auth.uid() OR property_matches.realtor_id = auth.uid())
));

CREATE POLICY "Authenticated users can update conversations for their matches" 
ON public.match_conversations 
FOR UPDATE 
USING (auth.uid() IS NOT NULL AND EXISTS ( 
  SELECT 1 FROM property_matches 
  WHERE property_matches.id = match_conversations.match_id 
    AND (property_matches.renter_id = auth.uid() OR property_matches.realtor_id = auth.uid())
))
WITH CHECK (auth.uid() IS NOT NULL AND EXISTS ( 
  SELECT 1 FROM property_matches 
  WHERE property_matches.id = match_conversations.match_id 
    AND (property_matches.renter_id = auth.uid() OR property_matches.realtor_id = auth.uid())
));