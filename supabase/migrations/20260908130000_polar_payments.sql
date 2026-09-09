-- Payments move from PayPal to Polar (https://polar.sh).
--
-- Polar is a merchant of record: it collects and remits the sales tax/VAT that
-- Hausto was carrying itself under PayPal, and its checkout is a hosted session
-- rather than an order we create and then capture, so there is no second
-- server-to-server call that can leave a paid renter without a pass.
--
-- The passes ledger was written around a PayPal order id. Nothing about the
-- ledger is provider-specific except that name, so the column is generalised
-- rather than duplicated: one id per purchase, whoever took the money.
-- Existing rows are PayPal and stay readable - the id is still the same string
-- it always was, and the unique constraint travels with the rename.

ALTER TABLE public.passes
  RENAME COLUMN paypal_order_id TO provider_order_id;

-- Which processor that id belongs to. Old rows predate Polar, so 'paypal' is
-- the right default for them; new inserts state 'polar' explicitly. Kept so a
-- refund or a dispute can be traced back to the right dashboard.
ALTER TABLE public.passes
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'paypal'
    CHECK (provider IN ('paypal', 'polar'));

-- viewing_addons is deliberately left alone: the $20 pack is retired, no new
-- rows are written, and its ids are all PayPal.

-- The UNIQUE constraint followed the column through the rename but kept its
-- generated name. Rename it too, so nothing in the schema still says "paypal".
ALTER TABLE public.passes
  RENAME CONSTRAINT passes_paypal_order_id_key TO passes_provider_order_id_key;
