
CREATE OR REPLACE FUNCTION public.handle_realtor_application_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.user_id, 'realtor'::app_role)
    ON CONFLICT (user_id, role) DO NOTHING;

    NEW.reviewed_at := now();
    IF NEW.reviewed_by IS NULL THEN
      NEW.reviewed_by := auth.uid();
    END IF;
  ELSIF NEW.status = 'rejected' AND (OLD.status IS DISTINCT FROM 'rejected') THEN
    NEW.reviewed_at := now();
    IF NEW.reviewed_by IS NULL THEN
      NEW.reviewed_by := auth.uid();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_realtor_application_approval
  BEFORE UPDATE ON public.realtor_applications
  FOR EACH ROW EXECUTE FUNCTION public.handle_realtor_application_approval();
