-- The WhatsApp number's own standing with Meta (2026-10-06).
--
-- Meta rates the number as well as each template, GREEN to RED, from how
-- recipients treat what it sends. The Pass digest is the first marketing this
-- number sends at any volume, and the itineraries go out from the same number.
-- whatsapp-template-sync reads the rating hourly into this row; the digest
-- sweep holds itself while it is YELLOW or RED, or Meta has flagged or
-- restricted the number (_shared/whatsapp/number-health.ts); the ops console
-- shows it.

CREATE TABLE IF NOT EXISTS public.whatsapp_number_status (
  id                text PRIMARY KEY DEFAULT 'singleton' CHECK (id = 'singleton'),
  -- GREEN | YELLOW | RED, or NA / UNKNOWN for a number Meta has not rated.
  quality_rating    text,
  -- CONNECTED | FLAGGED | RESTRICTED | ..., as Meta reports it.
  status            text,
  -- The last reading taken, and when the rating last changed from what.
  checked_at        timestamptz,
  previous_rating   text,
  rating_changed_at timestamptz,
  -- Why the last attempt to read it failed; cleared by the next good reading.
  last_error        text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.whatsapp_number_status (id) VALUES ('singleton') ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.whatsapp_number_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Ops read whatsapp_number_status" ON public.whatsapp_number_status;
CREATE POLICY "Ops read whatsapp_number_status" ON public.whatsapp_number_status
  FOR SELECT USING (public.has_role(auth.uid(), 'ops'::app_role));

DROP POLICY IF EXISTS "Admins read whatsapp_number_status" ON public.whatsapp_number_status;
CREATE POLICY "Admins read whatsapp_number_status" ON public.whatsapp_number_status
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::app_role));

COMMENT ON TABLE public.whatsapp_number_status IS
  'The WhatsApp number''s quality rating and status at Meta, synced hourly by whatsapp-template-sync. The digest sweep holds itself while it is YELLOW, RED, FLAGGED or RESTRICTED.';

-- The console shows templates whose quality is slipping beside the number, so
-- operators read template status too. It was admin-only because nothing in the
-- console sends templates; it still does not, and nothing here is sensitive.
DROP POLICY IF EXISTS "Ops read whatsapp_template_status" ON public.whatsapp_template_status;
CREATE POLICY "Ops read whatsapp_template_status" ON public.whatsapp_template_status
  FOR SELECT USING (public.has_role(auth.uid(), 'ops'::app_role));
