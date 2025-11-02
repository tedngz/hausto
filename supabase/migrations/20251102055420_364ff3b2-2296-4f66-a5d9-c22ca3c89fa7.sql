-- Add property source provider information columns to properties table
ALTER TABLE public.properties 
ADD COLUMN property_source_provider_name text,
ADD COLUMN property_source_provider_phone text;