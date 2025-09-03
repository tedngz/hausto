-- Security Fix Migration - Phase 2
-- Address linter warnings and strengthen security

-- 1. Fix Function Search Path Issues
-- Update all functions to have proper search_path set
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_post_authors_profiles(user_ids uuid[])
RETURNS TABLE(id uuid, name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
  -- Only return profiles for users who have made posts, and only if requestor is authenticated
  SELECT DISTINCT p.id, COALESCE(p.name, 'Anonymous User') AS name
  FROM public.profiles p
  WHERE p.id = ANY (user_ids)
    AND auth.uid() IS NOT NULL  -- Require authentication
    AND EXISTS (
      SELECT 1 FROM public.posts 
      WHERE posts.user_id = p.id
    );  -- Only return profiles of users who have made posts
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_subscriber()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
BEGIN
  INSERT INTO public.subscribers (user_id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_conversation_on_new_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
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
SET search_path = 'public'
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

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, name, email, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'name', ''),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'phone', '')
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

-- 2. Strengthen RLS Policies - Remove anonymous access where appropriate
-- Update profiles policies to be more restrictive
DROP POLICY IF EXISTS "Users can view their own profile data" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile securely" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile securely" ON public.profiles;

CREATE POLICY "Authenticated users can view their own profile" 
ON public.profiles 
FOR SELECT 
TO authenticated
USING (auth.uid() = id);

CREATE POLICY "Authenticated users can update their own profile" 
ON public.profiles 
FOR UPDATE 
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

CREATE POLICY "Authenticated users can insert their own profile" 
ON public.profiles 
FOR INSERT 
TO authenticated
WITH CHECK (auth.uid() = id);

-- Update subscribers policies
DROP POLICY IF EXISTS "Strict subscriber access control" ON public.subscribers;

CREATE POLICY "Authenticated users can manage their subscription" 
ON public.subscribers 
FOR ALL 
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Update daily_usage policies
DROP POLICY IF EXISTS "Authenticated users can view their own usage data" ON public.daily_usage;
DROP POLICY IF EXISTS "Authenticated users can update their own usage data" ON public.daily_usage;
DROP POLICY IF EXISTS "Authenticated users can insert their own usage data" ON public.daily_usage;

CREATE POLICY "Authenticated users can view own usage" 
ON public.daily_usage 
FOR SELECT 
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Authenticated users can update own usage" 
ON public.daily_usage 
FOR UPDATE 
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Authenticated users can insert own usage" 
ON public.daily_usage 
FOR INSERT 
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Update direct_messages policies
DROP POLICY IF EXISTS "Authenticated users can view messages from their matches" ON public.direct_messages;
DROP POLICY IF EXISTS "Authenticated users can update their own messages" ON public.direct_messages;
DROP POLICY IF EXISTS "Authenticated users can send messages to their matches" ON public.direct_messages;

CREATE POLICY "Authenticated users view match messages" 
ON public.direct_messages 
FOR SELECT 
TO authenticated
USING ((auth.uid() = sender_id) OR (auth.uid() = receiver_id));

CREATE POLICY "Authenticated users update own messages" 
ON public.direct_messages 
FOR UPDATE 
TO authenticated
USING (auth.uid() = sender_id);

CREATE POLICY "Authenticated users send messages" 
ON public.direct_messages 
FOR INSERT 
TO authenticated
WITH CHECK (
  (auth.uid() = sender_id) AND 
  (EXISTS (
    SELECT 1 FROM property_matches
    WHERE (property_matches.id = direct_messages.match_id) 
    AND ((property_matches.renter_id = auth.uid()) OR (property_matches.realtor_id = auth.uid()))
  ))
);

-- Update match_conversations policies
DROP POLICY IF EXISTS "Authenticated users can view conversations from their matches" ON public.match_conversations;
DROP POLICY IF EXISTS "Authenticated users can update conversations for their matches" ON public.match_conversations;
DROP POLICY IF EXISTS "Authenticated users can create conversations for their matches" ON public.match_conversations;

CREATE POLICY "Authenticated users view match conversations" 
ON public.match_conversations 
FOR SELECT 
TO authenticated
USING (EXISTS (
  SELECT 1 FROM property_matches
  WHERE (property_matches.id = match_conversations.match_id) 
  AND ((property_matches.renter_id = auth.uid()) OR (property_matches.realtor_id = auth.uid()))
));

CREATE POLICY "Authenticated users update match conversations" 
ON public.match_conversations 
FOR UPDATE 
TO authenticated
USING (EXISTS (
  SELECT 1 FROM property_matches
  WHERE (property_matches.id = match_conversations.match_id) 
  AND ((property_matches.renter_id = auth.uid()) OR (property_matches.realtor_id = auth.uid()))
))
WITH CHECK (EXISTS (
  SELECT 1 FROM property_matches
  WHERE (property_matches.id = match_conversations.match_id) 
  AND ((property_matches.renter_id = auth.uid()) OR (property_matches.realtor_id = auth.uid()))
));

CREATE POLICY "Authenticated users create match conversations" 
ON public.match_conversations 
FOR INSERT 
TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM property_matches
  WHERE (property_matches.id = match_conversations.match_id) 
  AND ((property_matches.renter_id = auth.uid()) OR (property_matches.realtor_id = auth.uid()))
));

-- Update chat_conversations policies
DROP POLICY IF EXISTS "Authenticated users can view their own conversations" ON public.chat_conversations;
DROP POLICY IF EXISTS "Authenticated users can update their own conversations" ON public.chat_conversations;
DROP POLICY IF EXISTS "Authenticated users can create their own conversations" ON public.chat_conversations;
DROP POLICY IF EXISTS "Authenticated users can delete their own conversations" ON public.chat_conversations;

CREATE POLICY "Authenticated users view own chat conversations" 
ON public.chat_conversations 
FOR SELECT 
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Authenticated users update own chat conversations" 
ON public.chat_conversations 
FOR UPDATE 
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Authenticated users create own chat conversations" 
ON public.chat_conversations 
FOR INSERT 
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Authenticated users delete own chat conversations" 
ON public.chat_conversations 
FOR DELETE 
TO authenticated
USING (auth.uid() = user_id);

-- Update chat_messages policies
DROP POLICY IF EXISTS "Authenticated users can view messages from their conversations" ON public.chat_messages;
DROP POLICY IF EXISTS "Authenticated users can create messages in their conversations" ON public.chat_messages;

CREATE POLICY "Authenticated users view own chat messages" 
ON public.chat_messages 
FOR SELECT 
TO authenticated
USING (EXISTS (
  SELECT 1 FROM chat_conversations
  WHERE (chat_conversations.id = chat_messages.conversation_id) 
  AND (chat_conversations.user_id = auth.uid())
));

CREATE POLICY "Authenticated users create own chat messages" 
ON public.chat_messages 
FOR INSERT 
TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM chat_conversations
  WHERE (chat_conversations.id = chat_messages.conversation_id) 
  AND (chat_conversations.user_id = auth.uid())
));

-- Update property_matches policies
DROP POLICY IF EXISTS "Renters can view their own matches" ON public.property_matches;
DROP POLICY IF EXISTS "Realtors can view matches for their properties" ON public.property_matches;
DROP POLICY IF EXISTS "Renters can create matches for themselves" ON public.property_matches;
DROP POLICY IF EXISTS "Renters can delete their own matches" ON public.property_matches;

CREATE POLICY "Authenticated renters view own matches" 
ON public.property_matches 
FOR SELECT 
TO authenticated
USING (auth.uid() = renter_id);

CREATE POLICY "Authenticated realtors view property matches" 
ON public.property_matches 
FOR SELECT 
TO authenticated
USING (auth.uid() = realtor_id);

CREATE POLICY "Authenticated renters create matches" 
ON public.property_matches 
FOR INSERT 
TO authenticated
WITH CHECK (auth.uid() = renter_id);

CREATE POLICY "Authenticated renters delete own matches" 
ON public.property_matches 
FOR DELETE 
TO authenticated
USING (auth.uid() = renter_id);