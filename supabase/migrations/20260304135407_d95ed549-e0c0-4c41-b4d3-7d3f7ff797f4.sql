
-- Drop the FK constraint on property_matches.property_id → properties.id
-- This allows storing external property IDs in property_matches
ALTER TABLE public.property_matches
  DROP CONSTRAINT IF EXISTS property_matches_property_id_fkey;

-- Add property_type column to distinguish internal vs external matches
ALTER TABLE public.property_matches
  ADD COLUMN IF NOT EXISTS property_type text NOT NULL DEFAULT 'internal';
