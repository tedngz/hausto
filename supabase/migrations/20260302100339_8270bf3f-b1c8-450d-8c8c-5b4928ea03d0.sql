-- Allow admins to SELECT all external_properties (including inactive)
CREATE POLICY "Admins can view all external properties"
ON public.external_properties
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

-- Allow admins to UPDATE external_properties (toggle active, etc.)
CREATE POLICY "Admins can update external properties"
ON public.external_properties
FOR UPDATE
USING (public.has_role(auth.uid(), 'admin'));

-- Allow admins to DELETE external_properties
CREATE POLICY "Admins can delete external properties"
ON public.external_properties
FOR DELETE
USING (public.has_role(auth.uid(), 'admin'));