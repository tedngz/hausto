
-- Revoke contact column access from the anonymous role; keep authenticated access intact.
REVOKE SELECT (contact_phone, contact_name) ON public.external_properties FROM anon;
