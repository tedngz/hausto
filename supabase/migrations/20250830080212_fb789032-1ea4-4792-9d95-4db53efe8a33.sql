-- CRITICAL SECURITY FIXES - Phase 1: Data Protection

-- 1. Fix Profile Data Exposure - Restrict profiles table access
DROP POLICY IF EXISTS "Users can view their own complete profile" ON public.profiles;

CREATE POLICY "Users can view their own complete profile" 
ON public.profiles 
FOR SELECT 
USING (auth.uid() = id AND auth.uid() IS NOT NULL);

-- 2. Update get_matched_public_profiles to only return name for matched users
CREATE OR REPLACE FUNCTION public.get_matched_public_profiles(user_ids uuid[])
RETURNS TABLE(id uuid, name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- Only return names for users who have matches - NO email/phone exposure
  SELECT p.id, COALESCE(p.name, 'Anonymous User') AS name
  FROM public.profiles p
  WHERE p.id = ANY (user_ids)
    AND auth.uid() IS NOT NULL  -- Require authentication
    AND (
      p.id = auth.uid() OR EXISTS (
        SELECT 1 FROM public.property_matches m
        WHERE (m.renter_id = p.id AND m.realtor_id = auth.uid())
           OR (m.realtor_id = p.id AND m.renter_id = auth.uid())
      )
    );
$function$;

-- 3. Fix get_realtor_contact_for_renter to respect contact sharing preference
CREATE OR REPLACE FUNCTION public.get_realtor_contact_for_renter(realtor_id uuid)
RETURNS TABLE(id uuid, name text, email text, phone text, bio text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- Only return contact info if contact sharing is allowed AND there's a match
  SELECT 
    p.id, 
    p.name, 
    CASE WHEN p.allow_contact_sharing THEN p.email ELSE '' END as email,
    CASE WHEN p.allow_contact_sharing THEN COALESCE(p.phone, '') ELSE '' END as phone,
    COALESCE(p.bio, '') as bio
  FROM public.profiles p
  WHERE p.id = realtor_id
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.property_matches m
      WHERE m.realtor_id = realtor_id 
        AND m.renter_id = auth.uid()
    );
$function$;

-- 4. Fix get_realtor_matched_renter_contact to respect contact sharing
CREATE OR REPLACE FUNCTION public.get_realtor_matched_renter_contact(renter_id uuid)
RETURNS TABLE(id uuid, name text, email text, phone text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- Only return contact info if contact sharing is allowed AND there's a match
  SELECT 
    p.id, 
    p.name, 
    CASE WHEN p.allow_contact_sharing THEN p.email ELSE '' END as email,
    CASE WHEN p.allow_contact_sharing THEN COALESCE(p.phone, '') ELSE '' END as phone
  FROM public.profiles p
  WHERE p.id = renter_id
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.property_matches m
      WHERE m.renter_id = renter_id 
        AND m.realtor_id = auth.uid()
    );
$function$;

-- 5. Remove anonymous access from chat conversations
DROP POLICY IF EXISTS "Users can view their own conversations" ON public.chat_conversations;
DROP POLICY IF EXISTS "Users can create their own conversations" ON public.chat_conversations;
DROP POLICY IF EXISTS "Users can update their own conversations" ON public.chat_conversations;
DROP POLICY IF EXISTS "Users can delete their own conversations" ON public.chat_conversations;

CREATE POLICY "Authenticated users can view their own conversations" 
ON public.chat_conversations 
FOR SELECT 
USING (auth.uid() = user_id AND auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can create their own conversations" 
ON public.chat_conversations 
FOR INSERT 
WITH CHECK (auth.uid() = user_id AND auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update their own conversations" 
ON public.chat_conversations 
FOR UPDATE 
USING (auth.uid() = user_id AND auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() = user_id AND auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete their own conversations" 
ON public.chat_conversations 
FOR DELETE 
USING (auth.uid() = user_id AND auth.uid() IS NOT NULL);

-- 6. Remove anonymous access from chat messages
DROP POLICY IF EXISTS "Users can view messages from their conversations" ON public.chat_messages;
DROP POLICY IF EXISTS "Users can create messages in their conversations" ON public.chat_messages;

CREATE POLICY "Authenticated users can view messages from their conversations" 
ON public.chat_messages 
FOR SELECT 
USING (auth.uid() IS NOT NULL AND EXISTS ( 
  SELECT 1 FROM chat_conversations 
  WHERE chat_conversations.id = chat_messages.conversation_id 
    AND chat_conversations.user_id = auth.uid()
));

CREATE POLICY "Authenticated users can create messages in their conversations" 
ON public.chat_messages 
FOR INSERT 
WITH CHECK (auth.uid() IS NOT NULL AND EXISTS ( 
  SELECT 1 FROM chat_conversations 
  WHERE chat_conversations.id = chat_messages.conversation_id 
    AND chat_conversations.user_id = auth.uid()
));

-- 7. Secure daily usage table - require authentication
DROP POLICY IF EXISTS "Users can view their own usage data" ON public.daily_usage;
DROP POLICY IF EXISTS "Users can insert their own usage data" ON public.daily_usage;
DROP POLICY IF EXISTS "Users can update their own usage data" ON public.daily_usage;

CREATE POLICY "Authenticated users can view their own usage data" 
ON public.daily_usage 
FOR SELECT 
USING (auth.uid() = user_id AND auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert their own usage data" 
ON public.daily_usage 
FOR INSERT 
WITH CHECK (auth.uid() = user_id AND auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update their own usage data" 
ON public.daily_usage 
FOR UPDATE 
USING (auth.uid() = user_id AND auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() = user_id AND auth.uid() IS NOT NULL);

-- 8. Secure subscribers table - ensure only user can access their subscription
DROP POLICY IF EXISTS "Users can view their own subscription data" ON public.subscribers;
DROP POLICY IF EXISTS "Users can insert their own subscription data" ON public.subscribers;
DROP POLICY IF EXISTS "Users can update their own subscription data" ON public.subscribers;

CREATE POLICY "Authenticated users can view their own subscription data" 
ON public.subscribers 
FOR SELECT 
USING (auth.uid() = user_id AND auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert their own subscription data" 
ON public.subscribers 
FOR INSERT 
WITH CHECK (auth.uid() = user_id AND auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update their own subscription data" 
ON public.subscribers 
FOR UPDATE 
USING (auth.uid() = user_id AND auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() = user_id AND auth.uid() IS NOT NULL);

-- 9. Secure direct messages - require authentication
DROP POLICY IF EXISTS "Users can view messages from their matches" ON public.direct_messages;
DROP POLICY IF EXISTS "Users can send messages to their matches" ON public.direct_messages;
DROP POLICY IF EXISTS "Users can update their own messages" ON public.direct_messages;

CREATE POLICY "Authenticated users can view messages from their matches" 
ON public.direct_messages 
FOR SELECT 
USING (auth.uid() IS NOT NULL AND (auth.uid() = sender_id OR auth.uid() = receiver_id));

CREATE POLICY "Authenticated users can send messages to their matches" 
ON public.direct_messages 
FOR INSERT 
WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = sender_id AND EXISTS ( 
  SELECT 1 FROM property_matches 
  WHERE property_matches.id = direct_messages.match_id 
    AND (property_matches.renter_id = auth.uid() OR property_matches.realtor_id = auth.uid())
));

CREATE POLICY "Authenticated users can update their own messages" 
ON public.direct_messages 
FOR UPDATE 
USING (auth.uid() IS NOT NULL AND auth.uid() = sender_id);

-- 10. Fix database functions with proper search_path
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

CREATE OR REPLACE FUNCTION public.handle_new_subscriber()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.subscribers (user_id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$function$;