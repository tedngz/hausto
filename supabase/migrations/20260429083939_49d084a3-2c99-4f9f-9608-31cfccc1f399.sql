-- Drop overly permissive INSERT policy on security_audit_log; service role bypasses RLS and triggers run as SECURITY DEFINER
DROP POLICY IF EXISTS "System can insert audit logs" ON public.security_audit_log;

-- Drop overly permissive policies on property_translations; service role bypasses RLS
DROP POLICY IF EXISTS "Service role can insert translations" ON public.property_translations;
DROP POLICY IF EXISTS "Service role can update translations" ON public.property_translations;