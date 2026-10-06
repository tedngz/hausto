-- The free viewing, once per WhatsApp number (pricing rework, build step 2;
-- SPEC §1, §9). Additive and replay-safe.
--
-- Until now the free tier's one viewing was stamped per account in
-- viewing_trials, at request time, behind a quiz-and-3-matches gate. Requests
-- are free now and the gate is gone, so every new email address would earn
-- another free viewing - each one real operator time and an agent's slot. The
-- number is the identity for everything inbound (CLAUDE.md), so it is the
-- identity here too: one row per number, claimed when a plan is locked in with
-- it, not when the request is made.
--
-- viewing_trials stays as history, and Fast-Track's trigger still writes it;
-- nothing in the viewing flow reads it any more.

CREATE TABLE IF NOT EXISTS public.free_viewings (
  phone_e164  text PRIMARY KEY,
  -- Who locked in with it, and what. Kept when the request is deleted, so a
  -- number cannot earn a second free viewing by losing the first request.
  user_id     uuid,
  request_id  uuid REFERENCES public.viewing_requests(id) ON DELETE SET NULL,
  item_id     uuid,
  used_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.free_viewings IS
  'One free viewing per WhatsApp number, claimed at lock-in (SPEC §9). The primary key is what stops two tabs spending it twice.';

-- Written and read by the lock-in functions with the service role only.
ALTER TABLE public.free_viewings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.free_viewings FROM anon, authenticated;
