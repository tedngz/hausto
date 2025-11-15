-- Create function to automatically deactivate expired properties
CREATE OR REPLACE FUNCTION public.deactivate_expired_properties()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Update properties that are still active but past the 10-day period
  UPDATE public.properties
  SET is_active = false,
      updated_at = now()
  WHERE is_active = true
    AND last_activated_at <= (now() - interval '10 days');
END;
$$;