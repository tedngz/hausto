-- AI operator plan, stage 1: shadow mode.
--
-- The AI operator proposes; a person decides. Nothing it produces is an event:
-- a proposal is a row here, with the typed action it would take and why, and
-- it only reaches the log when an operator approves it - under the operator's
-- own OPS:<uuid>, through the same ops-record-outcome door as everything else.
--
-- What makes shadow mode worth running is the decision on each row. Approved,
-- agreed (the operator did the same thing by hand), corrected (they did
-- something else), rejected: counted per action, that is the agreement rate
-- the plan gates stage 2 on. A proposal nobody decides tells us nothing, so
-- the planner supersedes one when the request moves on without it.

CREATE TABLE IF NOT EXISTS public.operator_proposals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      uuid NOT NULL REFERENCES public.viewing_requests(id) ON DELETE CASCADE,
  item_id         uuid REFERENCES public.request_items(id) ON DELETE CASCADE,
  -- One proposal per situation, ever. The key names the situation - "contact
  -- this agent", "nudge #2", "read reply X" - so a rejected proposal is not
  -- made again on the next pass, and a new situation gets a new key.
  dedupe_key      text NOT NULL,
  -- An ops action (_shared/viewing/ops-actions.ts) or ESCALATE: "a person
  -- has to handle this", which is a proposal too, and one that can be wrong.
  action          text NOT NULL,
  input           jsonb NOT NULL DEFAULT '{}'::jsonb,
  rationale       text NOT NULL,
  confidence      text NOT NULL DEFAULT 'HIGH' CHECK (confidence IN ('HIGH', 'LOW')),
  agent_version   text NOT NULL,
  status          text NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING', 'APPROVED', 'AGREED', 'CORRECTED', 'REJECTED', 'SUPERSEDED')),
  -- What was actually done, when it differed or was edited. The difference
  -- between this and `input` is what the next version learns from.
  executed_action text,
  executed_input  jsonb,
  edited          boolean NOT NULL DEFAULT false,
  decided_by      uuid,
  decided_at      timestamptz,
  decision_note   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS operator_proposals_pending_idx
  ON public.operator_proposals (request_id) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS operator_proposals_decided_idx
  ON public.operator_proposals (decided_at DESC) WHERE decided_at IS NOT NULL;

COMMENT ON TABLE public.operator_proposals IS
  'AI operator, shadow mode: typed actions it proposes and what an operator decided. Never an event until approved. '
  'Written by ai-operator-plan and ops-record-outcome with the service role.';

ALTER TABLE public.operator_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Ops read operator_proposals" ON public.operator_proposals;
CREATE POLICY "Ops read operator_proposals" ON public.operator_proposals
  FOR SELECT USING (public.has_role(auth.uid(), 'ops'::app_role));

DROP POLICY IF EXISTS "Admins read operator_proposals" ON public.operator_proposals;
CREATE POLICY "Admins read operator_proposals" ON public.operator_proposals
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::app_role));

-- ── the planner's clock ─────────────────────────────────────────────────────
-- Every 10 minutes, offset from the jobs drain (every 15) so the two do not
-- read the same log at the same instant. Same cron_secret pattern as
-- 20260912090000; unschedule only what this role owns (CLAUDE.md).
SELECT cron.unschedule('ai-operator-plan')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'ai-operator-plan' AND username = current_user
);

SELECT cron.schedule(
  'ai-operator-plan',
  '3,13,23,33,43,53 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://gbgrwjdmytaksrztcyzs.supabase.co/functions/v1/ai-operator-plan',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
