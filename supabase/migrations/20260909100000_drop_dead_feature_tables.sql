-- Drop seven tables belonging to features that were never used or are gone.
--
-- Each was checked for code references (none outside the generated types),
-- foreign keys, and functions, and each is empty or near enough:
--
--   posts                    1 row, last written July 2025
--   post_likes               2 rows, last written July 2025
--   support_conversations    0 rows
--   support_messages         0 rows
--   anonymous_chat_attempts  16 rows, last written November 2025
--   property_translations    1 row, last written February 2026
--   declined_properties      44 rows, last written March 2026
--
-- posts and post_likes were a social feed that took one post and two likes in
-- its first week and nothing since. The support tables were built and never
-- written to at all. The rest are experiments that stopped: an anonymous-chat
-- rate limiter, a translation cache, and a record of listings a renter
-- dismissed - the last of which the swipe deck fed, and the swipe deck is gone.
--
-- Nothing reads any of them. The realtor-renter chat these partly served was
-- retired earlier; what is left in the app is dead code, removed alongside this.

-- The only foreign key among them: post_likes -> posts, so the child goes first.
DROP TABLE IF EXISTS public.post_likes;
DROP TABLE IF EXISTS public.posts;

-- The feed's helpers. Signatures matter: DROP FUNCTION IF EXISTS matches on the
-- argument list, so naming one with empty parens silently drops nothing.
DROP FUNCTION IF EXISTS public.get_post_authors_profiles(user_ids uuid[]);
DROP FUNCTION IF EXISTS public.get_post_like_count(post_uuid uuid);
DROP FUNCTION IF EXISTS public.user_liked_post(post_uuid uuid);

DROP TABLE IF EXISTS public.support_messages;
DROP TABLE IF EXISTS public.support_conversations;

DROP TABLE IF EXISTS public.anonymous_chat_attempts;
DROP TABLE IF EXISTS public.property_translations;
DROP TABLE IF EXISTS public.declined_properties;
