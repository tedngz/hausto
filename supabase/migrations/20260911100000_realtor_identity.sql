-- Realtor identity (PLAN-v3 S2, SPEC §1).
--
-- A caveat worth reading before trusting these tables: the plan claimed realtor
-- phones were already resolved on 87% of active listings. They are not. Of 495
-- rows carrying a contact_phone, 404 hold a MASKED value - "0775 924 ***",
-- "098890 ***" - which the audit counted as resolved. Dialable numbers across
-- the whole index come to ten distinct people, and on active listings, two.
--
-- So this migration creates where identity will live and backfills the little
-- that is real. It does not solve acquisition, which is source-specific:
-- batdongsan hides the number behind "Bấm để hiện số", nhatot masks it in the
-- ad payload, and only housingsgn publishes one - being a single agency with a
-- single switchboard.
--
-- What makes it worth building now anyway is `source_agent_id`. nhatot hands us
-- `account_oid` free on every ad, so one resolution permanently attaches every
-- future listing from that broker. Resolution is expensive and one-time; the
-- join key is free and immediate.

CREATE TABLE IF NOT EXISTS public.realtors (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164    text UNIQUE NOT NULL,
  display_name  text,
  agency        text,
  language      text NOT NULL DEFAULT 'vi',
  -- Operator free text. Never parsed, never drives state - the same rule the
  -- ops console's outcome actions follow (SPEC §4).
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- One broker, many identities across sources. Keyed on the source's own id for
-- them, so a future listing resolves without asking anyone anything.
CREATE TABLE IF NOT EXISTS public.realtor_identities (
  realtor_id      uuid NOT NULL REFERENCES public.realtors(id) ON DELETE CASCADE,
  source          text NOT NULL,
  source_agent_id text NOT NULL,
  display_name    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, source_agent_id)
);

CREATE INDEX IF NOT EXISTS realtor_identities_realtor_idx
  ON public.realtor_identities (realtor_id);

ALTER TABLE public.external_properties
  ADD COLUMN IF NOT EXISTS source_agent_id text,
  ADD COLUMN IF NOT EXISTS realtor_id uuid REFERENCES public.realtors(id) ON DELETE SET NULL;

-- Ingest resolves in this order: agent identity, then phone, then NULL. The
-- first lookup is this index.
CREATE INDEX IF NOT EXISTS external_properties_source_agent_idx
  ON public.external_properties (source, source_agent_id)
  WHERE source_agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS external_properties_realtor_idx
  ON public.external_properties (realtor_id)
  WHERE realtor_id IS NOT NULL;

-- Contact details for third parties who never agreed to be in our database.
-- Readable by staff only; the renter-facing surface must never select from
-- these at all (SPEC §6 puts that at the query layer, not the template layer).
ALTER TABLE public.realtors           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.realtor_identities ENABLE ROW LEVEL SECURITY;

-- `ops` does not exist as an app_role yet - S5 adds it with the console. Until
-- then admin is the only human role that can see these, and the edge functions
-- reach them with the service role, which bypasses RLS.
DROP POLICY IF EXISTS "Admins manage realtors" ON public.realtors;
CREATE POLICY "Admins manage realtors" ON public.realtors
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins manage realtor identities" ON public.realtor_identities;
CREATE POLICY "Admins manage realtor identities" ON public.realtor_identities
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Normalize a Vietnamese number to E.164, or return NULL if it is not one.
-- Masked values ("0775 924 ***") fail the digit count and come back NULL rather
-- than being stored as a number nobody can ring - which is exactly the mistake
-- that made the index look 87% resolved.
CREATE OR REPLACE FUNCTION public.normalize_vn_phone(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  WITH c AS (SELECT regexp_replace(coalesce(raw, ''), '[^0-9+]', '', 'g') AS d)
  SELECT CASE
    WHEN (SELECT d FROM c) ~ '^\+84[0-9]{9}$'  THEN (SELECT d FROM c)
    WHEN (SELECT d FROM c) ~ '^84[0-9]{9}$'    THEN '+' || (SELECT d FROM c)
    WHEN (SELECT d FROM c) ~ '^0[0-9]{9}$'     THEN '+84' || substring((SELECT d FROM c) from 2)
    ELSE NULL
  END;
$$;

-- Backfill: one realtor per distinct real number. The name is whichever
-- contact_name came with it, preferring a row that has one.
INSERT INTO public.realtors (phone_e164, display_name)
SELECT DISTINCT ON (public.normalize_vn_phone(contact_phone))
       public.normalize_vn_phone(contact_phone),
       nullif(btrim(contact_name), '')
FROM public.external_properties
WHERE public.normalize_vn_phone(contact_phone) IS NOT NULL
ORDER BY public.normalize_vn_phone(contact_phone),
         (nullif(btrim(contact_name), '') IS NULL),   -- named rows first
         crawled_at DESC NULLS LAST
ON CONFLICT (phone_e164) DO NOTHING;

UPDATE public.external_properties p
SET realtor_id = r.id
FROM public.realtors r
WHERE r.phone_e164 = public.normalize_vn_phone(p.contact_phone)
  AND p.realtor_id IS DISTINCT FROM r.id;
