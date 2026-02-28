ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS rooms text NULL;
ALTER TABLE public.external_properties ADD COLUMN IF NOT EXISTS rooms text NULL;