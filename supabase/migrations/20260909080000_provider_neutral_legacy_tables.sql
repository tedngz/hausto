-- Bring the two tables the Polar migration left behind in line with the rest.
--
-- passes was generalised when payments moved to Polar - paypal_order_id became
-- provider_order_id alongside a provider column - but subscribers and
-- viewing_addons kept PayPal in their column names. The schema therefore still
-- claimed a processor that has been retired, deleted from the code, and had its
-- credentials removed. Anyone reading these tables would conclude Hausto takes
-- PayPal.
--
-- Neither table is dropped. Both are dormant rather than wrong: viewing_addons
-- is the ledger for the retired $20 pack and is still read by the spend-order
-- trigger, so a stray credit would be honoured rather than silently swallowed;
-- subscribers is written on every signup and read for entitlement.
--
-- Renames, not new columns: the ids are the same strings they always were, and
-- the unique constraint travels with the rename.

-- The $20 viewing pack. Retired, no live rows, but its shape should match the
-- passes ledger it was the model for.
ALTER TABLE public.viewing_addons
  RENAME COLUMN paypal_order_id TO provider_order_id;

ALTER TABLE public.viewing_addons
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'paypal'
    CHECK (provider IN ('paypal', 'polar'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'viewing_addons_paypal_order_id_key'
  ) THEN
    ALTER TABLE public.viewing_addons
      RENAME CONSTRAINT viewing_addons_paypal_order_id_key TO viewing_addons_provider_order_id_key;
  END IF;
END $$;

-- The retired $10/mo plan. Nothing subscribes any more - the Pass is a one-off
-- purchase and nothing recurs - so this column will stay null. It is renamed
-- rather than dropped because the table is still live and a processor id is
-- the right shape for it if a recurring product ever returns.
ALTER TABLE public.subscribers
  RENAME COLUMN paypal_subscription_id TO provider_subscription_id;

ALTER TABLE public.subscribers
  ADD COLUMN IF NOT EXISTS provider text
    CHECK (provider IS NULL OR provider IN ('paypal', 'polar'));

COMMENT ON COLUMN public.subscribers.provider_subscription_id IS
  'Processor-side subscription id. Null for every row: the $10/mo plan is retired and the Pass does not recur.';

COMMENT ON TABLE public.viewing_addons IS
  'Retired $20/10-viewing pack. No new rows are written - capture-viewing-addon-order is deleted - but the ledger is still read so any stray live credit is honoured.';
