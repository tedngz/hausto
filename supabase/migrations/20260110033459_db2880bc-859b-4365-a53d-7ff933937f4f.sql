-- Update the deactivate function to use proper comparison (properties expire AFTER 10 days)
CREATE OR REPLACE FUNCTION public.deactivate_expired_properties()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Update properties that are still active but past the 10-day period
  -- Using < instead of <= to match the is_property_within_active_period function logic
  UPDATE public.properties
  SET is_active = false,
      updated_at = now()
  WHERE is_active = true
    AND last_activated_at < (now() - interval '10 days');
END;
$function$;