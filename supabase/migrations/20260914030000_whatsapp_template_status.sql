-- Meta's current view of our message templates.
--
-- `templates.ts` carries an `approved` flag a human flips after Meta approves a
-- template. That flag is a deploy gate and stays one: a template nobody has
-- reviewed must not become sendable because an API said so.
--
-- What a code flag cannot do is notice the reverse. Meta can REJECT a template
-- on resubmission, PAUSE one whose quality drops, or DISABLE one outright, and
-- the flag stays `true` through all of it. The first sign would be a graph_400
-- on the message that mattered - an itinerary a renter was waiting for.
--
-- So the two are reconciled rather than merged. The code says what we intend to
-- send; this table says what Meta currently permits. `sendTemplate` needs both,
-- and `whatsapp-template-sync` keeps this side honest on a schedule.

CREATE TABLE IF NOT EXISTS public.whatsapp_template_status (
  name            text PRIMARY KEY,
  -- APPROVED | PENDING | REJECTED | PAUSED | DISABLED | UNKNOWN, as Meta reports
  -- it. Only APPROVED permits a send; the others are kept distinct because the
  -- remedies differ - REJECTED needs editing and resubmitting, PAUSED needs the
  -- quality problem fixed, PENDING needs patience.
  status          text NOT NULL,
  category        text,
  language        text,
  meta_id         text,
  -- GREEN | YELLOW | RED. A template sitting at RED is close to being paused,
  -- which is a warning with time on it rather than a failure.
  quality         text,
  last_synced_at  timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_template_status_synced_idx
  ON public.whatsapp_template_status (last_synced_at DESC);

ALTER TABLE public.whatsapp_template_status ENABLE ROW LEVEL SECURITY;

-- Admin read only. Nothing renter-facing has any use for this, and the ops
-- console does not send templates - it records outcomes.
DROP POLICY IF EXISTS "Admins read whatsapp_template_status" ON public.whatsapp_template_status;
CREATE POLICY "Admins read whatsapp_template_status" ON public.whatsapp_template_status
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::app_role));

COMMENT ON TABLE public.whatsapp_template_status IS
  'Meta''s current template status, synced by whatsapp-template-sync. Consulted by sendTemplate alongside the approved flag in templates.ts - a send needs both.';
