-- Freshness, split from liveness.
--
-- `last_verified_at` only ever meant "the source URL still resolves". That is
-- not the question ops needs answered before messaging a broker, which is "is
-- this unit still available at this price". Two columns for the two halves:
--
--   price_confirmed_at  we re-read the listing's own price and it still matches
--                       what we are showing. Only set by sources where the price
--                       can actually be read back - today that is nhatot, whose
--                       ad payload carries it. Left NULL elsewhere rather than
--                       filled in with a verification we did not perform.
--
--   delisted_at         a re-verification CONFIRMED the listing is gone, or it
--                       went 21 days without its price being confirmed. Distinct
--                       from `deactivated_at`, which stays what it is: a URL
--                       stopped resolving, which is weaker evidence and is
--                       routinely wrong on nhatot, where expired ads come back
--                       under the same id when the seller reposts.
ALTER TABLE public.external_properties
  ADD COLUMN IF NOT EXISTS delisted_at        timestamptz,
  ADD COLUMN IF NOT EXISTS price_confirmed_at timestamptz;

-- Start the 21-day clock from the last successful verification rather than from
-- NULL, so the first decay pass does not sweep the whole index. Safe to do
-- today: every one of the 145 active rows was verified within the last three
-- days, so nothing is already past the window.
--
-- This backfills rows we have not price-confirmed, which is a deliberate grace
-- period, not a claim that the price was checked. Only nhatot rows are subject
-- to the decay, and their first real confirmation replaces this value within a
-- verification cycle.
UPDATE public.external_properties
SET price_confirmed_at = last_verified_at
WHERE is_active
  AND price_confirmed_at IS NULL
  AND last_verified_at IS NOT NULL;

-- The decay sweep reads exactly this: active rows of one source, oldest
-- confirmation first.
CREATE INDEX IF NOT EXISTS external_properties_price_confirmed_idx
  ON public.external_properties (source, price_confirmed_at)
  WHERE is_active;
