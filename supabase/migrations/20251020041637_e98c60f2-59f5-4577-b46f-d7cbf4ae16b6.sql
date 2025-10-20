-- Add columns to track property listing status
ALTER TABLE public.properties 
ADD COLUMN is_active boolean NOT NULL DEFAULT true,
ADD COLUMN last_activated_at timestamp with time zone NOT NULL DEFAULT now();

-- Create index for better query performance
CREATE INDEX idx_properties_active_status ON public.properties(is_active, last_activated_at);

-- Create function to check if property is still within active period (10 days)
CREATE OR REPLACE FUNCTION public.is_property_within_active_period(activated_at timestamp with time zone)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT activated_at > (now() - interval '10 days');
$$;

-- Create a view that shows only truly active properties (marked active AND within 10 day window)
CREATE OR REPLACE VIEW public.active_properties AS
SELECT p.*
FROM public.properties p
WHERE p.is_active = true 
  AND public.is_property_within_active_period(p.last_activated_at);

-- Grant select permission on the view
GRANT SELECT ON public.active_properties TO authenticated;