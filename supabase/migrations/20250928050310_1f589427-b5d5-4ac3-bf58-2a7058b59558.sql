-- Add property_source_link column to properties table
ALTER TABLE public.properties 
ADD COLUMN property_source_link TEXT;