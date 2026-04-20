ALTER TABLE public.external_properties
ADD COLUMN IF NOT EXISTS last_verification_reason text,
ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_external_properties_deactivated_at
ON public.external_properties (deactivated_at DESC NULLS LAST)
WHERE is_active = false;