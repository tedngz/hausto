ALTER TABLE public.external_properties
ADD COLUMN IF NOT EXISTS phone_extraction_attempts INTEGER NOT NULL DEFAULT 0;