
-- Add latitude and longitude columns to properties table
ALTER TABLE public.properties
ADD COLUMN latitude double precision DEFAULT NULL,
ADD COLUMN longitude double precision DEFAULT NULL;

-- Add latitude and longitude columns to external_properties table
ALTER TABLE public.external_properties
ADD COLUMN latitude double precision DEFAULT NULL,
ADD COLUMN longitude double precision DEFAULT NULL;
