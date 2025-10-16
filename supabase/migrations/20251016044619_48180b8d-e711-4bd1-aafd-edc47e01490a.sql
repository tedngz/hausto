-- Add amenities column to properties table
ALTER TABLE public.properties 
ADD COLUMN amenities text[] DEFAULT '{}'::text[];