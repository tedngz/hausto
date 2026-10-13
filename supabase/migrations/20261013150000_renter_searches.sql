-- WhatsApp search from a cold DM (2026-10-13, PLAN-v3 "The WhatsApp agent").
-- Additive and replay-safe.
--
-- One row per burst of renter messages the search agent answered or refused.
-- It is four things at once, which is why it is one table:
--
--   - the quota: rows with `counted` since UTC midnight, per renter and in
--     total (search-limits.ts);
--   - the claim: `answers_message_id` is unique, so two dispatches settling on
--     the same burst, or a webhook redelivery, answer it once;
--   - the renter's preferences: the newest row's `filters` are what the next
--     message refines;
--   - the list a reply of "2" picks from: `listing_ids`, in the order shown.
--
-- Not request state, so not the events log (invariant 1 is about requests and
-- their items). A search makes no request; the renter does, on the site.

CREATE TABLE IF NOT EXISTS public.renter_searches (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  renter_id           uuid NOT NULL REFERENCES public.renters(id) ON DELETE CASCADE,
  -- The newest inbound message of the burst this answers.
  answers_message_id  uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  query               text NOT NULL,
  -- Spent against the renter's allowance and the daily cap. False for a
  -- refusal, and for a search whose model call failed - neither cost anything.
  counted             boolean NOT NULL DEFAULT false,
  -- Why it was not answered: NUMBER_LIMIT, ACCOUNT_CREDITS, DAILY_LIMIT,
  -- GLOBAL_CAP (search-limits.ts), or an error code.
  refused             text,
  filters             jsonb,
  listing_ids         uuid[] NOT NULL DEFAULT '{}',
  message_id          uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS renter_searches_answers_message_id_key
  ON public.renter_searches (answers_message_id);
CREATE INDEX IF NOT EXISTS renter_searches_renter_created_idx
  ON public.renter_searches (renter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS renter_searches_created_idx
  ON public.renter_searches (created_at) WHERE counted;

COMMENT ON TABLE public.renter_searches IS
  'One row per WhatsApp search burst: quota, claim, the renter''s last filters, and the list a numbered reply picks from (search-limits.ts).';

-- Written and read by viewing-agent-search and the inbound path with the
-- service role only. It holds what renters asked for.
ALTER TABLE public.renter_searches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.renter_searches FROM anon, authenticated;
