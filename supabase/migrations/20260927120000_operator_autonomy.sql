-- AI operator plan, stage 2: the AI operator may answer renters itself.
--
-- Three locks, and all three have to be open (_shared/viewing/autonomy.ts):
--   1. AI_OPERATOR_AUTONOMY, an edge-function secret. Unset means off.
--   2. `ai_operator_controls.paused`, which any operator can set from the
--      console - the kill switch that needs no dashboard access.
--   3. The measured gate: stage 1's agreement on that action, over enough
--      decisions, computed from `operator_proposals` on every pass.
--
-- Even then an autonomous proposal waits `execute_after` before it runs, and
-- an operator can hold, rewrite or reject it in that window.

-- ── what an autonomous proposal can become ─────────────────────────────────
-- EXECUTED: the AI operator ran it, under AGENT:<version>.
-- FLAGGED:  an operator marked an executed one as wrong afterwards. A sent
--           WhatsApp message cannot be unsent; flagging is what feeds the
--           correction rate that gates stage 3, and what tells a person to
--           follow up with the renter.
ALTER TABLE public.operator_proposals DROP CONSTRAINT IF EXISTS operator_proposals_status_check;
ALTER TABLE public.operator_proposals ADD CONSTRAINT operator_proposals_status_check
  CHECK (status IN ('PENDING', 'APPROVED', 'AGREED', 'CORRECTED', 'REJECTED', 'SUPERSEDED', 'EXECUTED', 'FLAGGED'));

ALTER TABLE public.operator_proposals
  -- When the AI operator will run this itself, unless a person acts first.
  -- NULL means it waits for a person, which is every proposal in shadow mode.
  ADD COLUMN IF NOT EXISTS execute_after timestamptz,
  ADD COLUMN IF NOT EXISTS executed_at   timestamptz;

CREATE INDEX IF NOT EXISTS operator_proposals_due_idx
  ON public.operator_proposals (execute_after) WHERE status = 'PENDING' AND execute_after IS NOT NULL;

-- ── the kill switch ─────────────────────────────────────────────────────────
-- One row. Written only through ops-record-outcome (SET_AUTONOMY), so a pause
-- is attributable; read by the planner on every pass and by the console, which
-- also shows `last_state` - what the planner last concluded about each lock,
-- since the console cannot read an edge-function secret.
CREATE TABLE IF NOT EXISTS public.ai_operator_controls (
  id          text PRIMARY KEY DEFAULT 'singleton' CHECK (id = 'singleton'),
  paused      boolean NOT NULL DEFAULT false,
  note        text,
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  last_state  jsonb,
  last_run_at timestamptz
);

INSERT INTO public.ai_operator_controls (id) VALUES ('singleton') ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.ai_operator_controls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Ops read ai_operator_controls" ON public.ai_operator_controls;
CREATE POLICY "Ops read ai_operator_controls" ON public.ai_operator_controls
  FOR SELECT USING (public.has_role(auth.uid(), 'ops'::app_role));

DROP POLICY IF EXISTS "Admins read ai_operator_controls" ON public.ai_operator_controls;
CREATE POLICY "Admins read ai_operator_controls" ON public.ai_operator_controls
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::app_role));

COMMENT ON TABLE public.ai_operator_controls IS
  'AI operator kill switch (paused) and its last computed autonomy state. One row. Written via ops-record-outcome.';
