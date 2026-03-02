-- Scope admin policies to authenticated users only (avoid "anonymous access" linter warnings)
DROP POLICY IF EXISTS "Admins can view all external properties" ON public.external_properties;
DROP POLICY IF EXISTS "Admins can update external properties" ON public.external_properties;
DROP POLICY IF EXISTS "Admins can delete external properties" ON public.external_properties;

CREATE POLICY "Admins can view all external properties"
ON public.external_properties
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update external properties"
ON public.external_properties
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete external properties"
ON public.external_properties
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));