CREATE OR REPLACE FUNCTION public.get_profiles_for_admin(_user_ids uuid[])
RETURNS TABLE(id uuid, name text, email text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name, p.email
  FROM public.profiles p
  WHERE p.id = ANY(_user_ids)
    AND public.has_role(auth.uid(), 'admin');
$$;

REVOKE EXECUTE ON FUNCTION public.get_profiles_for_admin(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profiles_for_admin(uuid[]) TO authenticated;