-- Fix security vulnerability in post_likes table
-- Remove overly permissive policy that exposes user IDs publicly
DROP POLICY "Anyone can view likes" ON public.post_likes;

-- Create more secure policy: users can only see their own likes
CREATE POLICY "Users can view their own likes" 
ON public.post_likes 
FOR SELECT 
USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);

-- Create a secure function to get like counts without exposing user IDs
CREATE OR REPLACE FUNCTION public.get_post_like_count(post_uuid uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM public.post_likes
  WHERE post_id = post_uuid;
$$;

-- Create a secure function to check if current user liked a specific post
CREATE OR REPLACE FUNCTION public.user_liked_post(post_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.post_likes
    WHERE post_id = post_uuid 
      AND user_id = auth.uid()
  );
$$;