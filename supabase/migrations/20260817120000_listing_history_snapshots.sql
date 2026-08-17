-- Listing history. Crawls previously overwrote external_properties in place, so
-- months of crawling produced no time series. Snapshots are append-on-change:
-- a row is written only when a watched field actually differs from the last
-- observation, so a listing that never moves never grows the table.
--
-- The trigger lives in the database rather than the crawler because four code
-- paths write to external_properties (crawl-external-properties,
-- recrawl-external-listing, the backfills, and admin edits) and all of them
-- should be captured.
--
-- contact_phone is stored HASHED. The table is publicly readable so the client
-- can render price history, and raw contact details stay gated behind
-- get_external_property_contact(s). The hash is enough to detect "the listing
-- changed hands" without exposing the number.
--
-- description and raw_data are deliberately NOT captured: page text already had
-- to be scrubbed once (20260807030000_scrub_raw_data_page_text.sql) and an
-- append-only table would recreate that problem permanently.

CREATE TABLE IF NOT EXISTS public.external_property_snapshots (
  id                 BIGSERIAL PRIMARY KEY,
  listing_id         UUID NOT NULL REFERENCES public.external_properties(id) ON DELETE CASCADE,
  observed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  price              NUMERIC,
  size               TEXT,
  rooms              TEXT,
  title              TEXT,
  contact_phone_hash TEXT,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  content_hash       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_external_property_snapshots_listing
ON public.external_property_snapshots (listing_id, observed_at DESC, id DESC);

ALTER TABLE public.external_property_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view listing snapshots" ON public.external_property_snapshots;
CREATE POLICY "Anyone can view listing snapshots" ON public.external_property_snapshots
  FOR SELECT USING (true);

-- No INSERT/UPDATE/DELETE policies: only the SECURITY DEFINER trigger below
-- (and the service role) may write history.

CREATE OR REPLACE FUNCTION public.capture_external_property_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone_hash TEXT;
  v_hash       TEXT;
  v_last_hash  TEXT;
BEGIN
  v_phone_hash := CASE
    WHEN NEW.contact_phone IS NULL OR NEW.contact_phone = '' THEN NULL
    ELSE md5(NEW.contact_phone)
  END;

  v_hash := md5(concat_ws('|',
    coalesce(NEW.price::text, ''),
    coalesce(NEW.size, ''),
    coalesce(NEW.rooms, ''),
    coalesce(NEW.title, ''),
    coalesce(v_phone_hash, ''),
    NEW.is_active::text
  ));

  SELECT s.content_hash INTO v_last_hash
  FROM public.external_property_snapshots s
  WHERE s.listing_id = NEW.id
  ORDER BY s.observed_at DESC, s.id DESC
  LIMIT 1;

  IF v_last_hash IS DISTINCT FROM v_hash THEN
    INSERT INTO public.external_property_snapshots
      (listing_id, price, size, rooms, title, contact_phone_hash, is_active, content_hash)
    VALUES
      (NEW.id, NEW.price, NEW.size, NEW.rooms, NEW.title, v_phone_hash, NEW.is_active, v_hash);
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_external_property_snapshot_insert ON public.external_properties;
CREATE TRIGGER trg_external_property_snapshot_insert
AFTER INSERT ON public.external_properties
FOR EACH ROW EXECUTE FUNCTION public.capture_external_property_snapshot();

-- The WHEN clause keeps vibe/geocode/verification-only updates from even
-- entering the function; only the watched fields can produce a new snapshot.
DROP TRIGGER IF EXISTS trg_external_property_snapshot_update ON public.external_properties;
CREATE TRIGGER trg_external_property_snapshot_update
AFTER UPDATE ON public.external_properties
FOR EACH ROW
WHEN (
  OLD.price         IS DISTINCT FROM NEW.price
  OR OLD.size          IS DISTINCT FROM NEW.size
  OR OLD.rooms         IS DISTINCT FROM NEW.rooms
  OR OLD.title         IS DISTINCT FROM NEW.title
  OR OLD.contact_phone IS DISTINCT FROM NEW.contact_phone
  OR OLD.is_active     IS DISTINCT FROM NEW.is_active
)
EXECUTE FUNCTION public.capture_external_property_snapshot();

-- Seed: one baseline snapshot per existing listing, timestamped at the crawl
-- that produced the state currently in the row.
INSERT INTO public.external_property_snapshots
  (listing_id, observed_at, price, size, rooms, title, contact_phone_hash, is_active, content_hash)
SELECT
  p.id,
  COALESCE(p.crawled_at, p.updated_at, p.created_at, NOW()),
  p.price, p.size, p.rooms, p.title,
  CASE WHEN p.contact_phone IS NULL OR p.contact_phone = '' THEN NULL ELSE md5(p.contact_phone) END,
  p.is_active,
  md5(concat_ws('|',
    coalesce(p.price::text, ''),
    coalesce(p.size, ''),
    coalesce(p.rooms, ''),
    coalesce(p.title, ''),
    coalesce(CASE WHEN p.contact_phone IS NULL OR p.contact_phone = '' THEN NULL ELSE md5(p.contact_phone) END, ''),
    p.is_active::text
  ))
FROM public.external_properties p
WHERE NOT EXISTS (
  SELECT 1 FROM public.external_property_snapshots s WHERE s.listing_id = p.id
);
