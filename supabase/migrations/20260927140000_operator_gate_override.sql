-- AI operator: an explicit, visible override of the measured gate.
--
-- The owner chose on 2026-09-27 to let the AI operator send renter replies
-- before stage 1 had produced the 30 decisions the gate asks for. That is a
-- product call, and it is recorded here as one: a list of actions whose gate
-- is skipped, shown on the console as "Gate skipped by override", removable
-- from there. The other two locks still apply - AI_OPERATOR_AUTONOMY must list
-- the action and nobody may have paused it - and so does the flag ceiling, so
-- an override that starts going wrong still closes itself.
ALTER TABLE public.ai_operator_controls
  ADD COLUMN IF NOT EXISTS gate_override text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.ai_operator_controls.gate_override IS
  'Actions whose measured agreement gate is skipped (autonomy.ts). Env switch, pause and flag ceiling still apply.';
