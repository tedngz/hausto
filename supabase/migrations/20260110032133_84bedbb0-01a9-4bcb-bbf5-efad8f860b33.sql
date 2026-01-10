-- Fix the active period check to include the last day (use >= instead of >)
-- Properties should be visible for the full 10 days including day 0
CREATE OR REPLACE FUNCTION public.is_property_within_active_period(activated_at timestamp with time zone)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  -- Property is within active period if activated_at is within the last 10 days (inclusive)
  RETURN activated_at >= (now() - interval '10 days');
END;
$$;