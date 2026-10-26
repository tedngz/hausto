-- The lease terms a listing's source states (SPEC §0 "Lease terms",
-- _shared/lease-terms.ts): whether the unit is free and from when, the minimum
-- lease, the deposit, the fees on top of the rent, and pets.
--
-- Renters ask these first, and the AI answering them (chat-ai, the comparison
-- engine, the AI operator's drafts) can only repeat what it is given. They are
-- read where the listing is read - jhouse's CRM fields, rentapartment's
-- deposit field and pet tag, every source's own text - and refreshed by
-- verify-external-listings, which re-reads the same sources. Where a column is
-- NULL the source does not say, and the first message to the agent asks
-- (realtor/drafts.ts).
--
-- `terms_read_at` is what tells "the source does not say" (read, NULL) from
-- "never looked" (NULL). Additive, and IF NOT EXISTS throughout, so a replay
-- is harmless.

ALTER TABLE public.external_properties
  ADD COLUMN IF NOT EXISTS availability text,
  ADD COLUMN IF NOT EXISTS available_from date,
  ADD COLUMN IF NOT EXISTS min_lease_months smallint,
  ADD COLUMN IF NOT EXISTS deposit_months_min numeric(3,1),
  ADD COLUMN IF NOT EXISTS deposit_months_max numeric(3,1),
  ADD COLUMN IF NOT EXISTS pets_allowed boolean,
  ADD COLUMN IF NOT EXISTS fees jsonb,
  ADD COLUMN IF NOT EXISTS terms_read_at timestamptz;

-- The same bounds the reader keeps (lease-terms.ts DEPOSIT_RANGE, LEASE_RANGE):
-- a value outside them is a misread, and a misread term is a promise nobody made.
DO $$
BEGIN
  ALTER TABLE public.external_properties ADD CONSTRAINT external_properties_availability_check
    CHECK (availability IN ('AVAILABLE_NOW', 'AVAILABLE_SOON'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.external_properties ADD CONSTRAINT external_properties_min_lease_check
    CHECK (min_lease_months BETWEEN 1 AND 60);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.external_properties ADD CONSTRAINT external_properties_deposit_check
    CHECK (deposit_months_min BETWEEN 0.5 AND 6 AND deposit_months_max BETWEEN deposit_months_min AND 6);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.external_properties ADD CONSTRAINT external_properties_fees_check
    CHECK (jsonb_typeof(fees) = 'array');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- external_properties has no table-level SELECT for anon or authenticated;
-- each readable column is granted on its own (20260708165420), and a new one
-- starts unreadable. These are public facts about the unit, the kind
-- public-property-search already serves, and say nothing about the agent. The
-- ops console reads them as `authenticated` to draft the first message to an
-- agent, asking about whichever terms the listing leaves out.
--
-- ops_request_items_view is deliberately not extended. Edge functions and
-- this migration deploy in parallel on merge, so everything that reads these
-- columns reads them on their own and treats a failed read as "not stated" -
-- which only means the agent is asked about all four.
GRANT SELECT (availability, available_from, min_lease_months, deposit_months_min, deposit_months_max, pets_allowed, fees, terms_read_at)
  ON public.external_properties TO anon, authenticated;
