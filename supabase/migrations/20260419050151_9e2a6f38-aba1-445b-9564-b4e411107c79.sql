ALTER TABLE public.external_properties
ADD COLUMN IF NOT EXISTS verification_failures INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_verification_status TEXT;

CREATE INDEX IF NOT EXISTS idx_external_properties_verification
ON public.external_properties (is_active, last_verified_at NULLS FIRST);