-- Concierge availability requests (complex_inquiries) need an admin workflow:
-- notes + a handled timestamp for the dashboard, and a notified_at stamp so the
-- email notifier is idempotent (the id alone must not let anyone re-trigger mail).
ALTER TABLE public.complex_inquiries
  ADD COLUMN IF NOT EXISTS admin_notes text,
  ADD COLUMN IF NOT EXISTS handled_at timestamptz,
  ADD COLUMN IF NOT EXISTS notified_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_complex_inquiries_created_at
  ON public.complex_inquiries(created_at DESC);
