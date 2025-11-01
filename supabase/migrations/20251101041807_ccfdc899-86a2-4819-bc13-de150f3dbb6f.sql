-- Allow public viewing of individual properties by ID (for shareable links)
-- This enables non-authenticated users to view a property when they have the direct link
CREATE POLICY "Anyone can view individual active properties by direct link"
ON public.properties
FOR SELECT
USING (is_active = true AND is_property_within_active_period(last_activated_at));