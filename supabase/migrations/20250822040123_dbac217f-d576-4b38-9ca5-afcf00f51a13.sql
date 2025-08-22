-- Drop the existing foreign key constraint that might be causing issues
ALTER TABLE public.daily_usage DROP CONSTRAINT IF EXISTS daily_usage_user_id_fkey;

-- Recreate the table with proper constraints but no foreign key to auth.users (since that's in auth schema)
-- The RLS policies will handle the security

-- Make sure the user_id column is properly set up
ALTER TABLE public.daily_usage ALTER COLUMN user_id SET NOT NULL;