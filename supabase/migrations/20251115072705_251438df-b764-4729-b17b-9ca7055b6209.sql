-- Create a function to automatically set subscription_end when manually upgrading
CREATE OR REPLACE FUNCTION public.set_subscription_end_on_manual_upgrade()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- If subscription_tier is being set to premium and subscribed is true
  -- but subscription_end is null (indicating manual upgrade), set it to 30 days from now
  IF NEW.subscription_tier = 'premium' 
     AND NEW.subscribed = true 
     AND NEW.subscription_end IS NULL 
     AND (OLD.subscription_tier IS DISTINCT FROM NEW.subscription_tier 
          OR OLD.subscribed IS DISTINCT FROM NEW.subscribed) THEN
    NEW.subscription_end = now() + interval '30 days';
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger to run before insert or update on subscribers table
DROP TRIGGER IF EXISTS trigger_set_subscription_end ON public.subscribers;
CREATE TRIGGER trigger_set_subscription_end
  BEFORE INSERT OR UPDATE ON public.subscribers
  FOR EACH ROW
  EXECUTE FUNCTION public.set_subscription_end_on_manual_upgrade();