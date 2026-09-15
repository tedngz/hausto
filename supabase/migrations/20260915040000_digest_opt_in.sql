-- Consent for the weekly digest, separate from everything else.
--
-- `renters.opted_out_at` is the blanket stop: a renter who said STOP hears
-- nothing again. What it cannot express is the far more common middle case - a
-- renter who wants us to arrange the viewings they asked for, and does not want
-- a weekly mailshot.
--
-- Treating a viewing request as consent for recurring marketing is how a
-- WhatsApp number gets quality-rated down and eventually limited, and the
-- damage lands on the messages that actually matter: the itinerary someone is
-- waiting for. So the digest gets its own flag, it defaults to NULL, and
-- nothing in the codebase sets it except a renter deliberately opting in.
--
-- NULL rather than a boolean false, because when they agreed is worth keeping:
-- consent has a date, and "we have been messaging them weekly since March" is a
-- question that gets asked.

ALTER TABLE public.renters
  ADD COLUMN IF NOT EXISTS digest_opt_in_at timestamptz;

COMMENT ON COLUMN public.renters.digest_opt_in_at IS
  'When this renter opted in to the weekly new-listing digest. NULL means no. Deliberately separate from opted_out_at: a viewing request is not consent for recurring marketing.';

-- The digest sweep reads exactly this: opted in, not opted out.
CREATE INDEX IF NOT EXISTS renters_digest_opt_in_idx
  ON public.renters (digest_opt_in_at)
  WHERE digest_opt_in_at IS NOT NULL AND opted_out_at IS NULL;
