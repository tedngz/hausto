-- PLAN-v3 S3, SPEC §0: `price_confidence` is LOW when the stored price
-- disagrees by more than 15% with the rent the listing's own title or
-- description quotes. Until now only the plausible-band half was built.
--
-- The work is split where each half can be tested:
--
--   Reading the text is TypeScript (`_shared/price-mentions.ts`), because it is
--   a pile of regexes over English and Vietnamese that needs a hundred cases in
--   CI, and SQL has no test runner here. The `price-crosscheck` function runs
--   it over every active listing on the schedule below and stores the lowest
--   and highest rent the text quotes. Nothing needs backfilling by hand: the
--   first run fills every active row, and a row whose copy is rewritten later
--   is corrected on the next pass.
--
--   Deciding is SQL, in `price_confidence_for`, so the trigger applies it on
--   every write - a crawl, verification re-pricing a listing, a hand edit -
--   and a changed price is judged against the stored range at once rather than
--   at the next sweep. `canonical-price.test.ts` evaluates this definition in
--   CI.
--
-- A price anywhere inside the quoted range agrees. An advert naming several
-- units ("1PN 8tr, 2PN 12tr") does not say which one this row is, and guessing
-- is how a real listing gets flagged. LOW keeps a listing searchable and stops
-- it being requested (intake.ts screenCandidates).

ALTER TABLE public.external_properties
  ADD COLUMN IF NOT EXISTS described_price_min_vnd integer,
  ADD COLUMN IF NOT EXISTS described_price_max_vnd integer;

COMMENT ON COLUMN public.external_properties.described_price_min_vnd IS
  'Lowest monthly rent (VND) quoted in title/description, set by price-crosscheck. NULL when none is quoted.';
COMMENT ON COLUMN public.external_properties.described_price_max_vnd IS
  'Highest monthly rent (VND) quoted in title/description, set by price-crosscheck. NULL when none is quoted.';

CREATE OR REPLACE FUNCTION public.price_confidence_for(_price_vnd integer, _described_min integer, _described_max integer)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _price_vnd IS NULL THEN NULL
    WHEN _price_vnd NOT BETWEEN 1000000 AND 500000000 THEN 'LOW'
    WHEN _described_min IS NOT NULL AND _price_vnd < _described_min * 0.85 THEN 'LOW'
    WHEN _described_max IS NOT NULL AND _price_vnd > _described_max * 1.15 THEN 'LOW'
    ELSE 'HIGH'
  END;
$$;

CREATE OR REPLACE FUNCTION public.sync_canonical_listing_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.bedrooms        := public.parse_bedrooms(NEW.rooms);
  NEW.bedrooms_is_min := public.parse_bedrooms_is_min(NEW.rooms);
  NEW.area_sqm        := public.parse_area_sqm(NEW.size);
  NEW.district_code   := public.vn_district_code(NEW.city, NEW.location);
  NEW.price_vnd        := public.canonical_price_vnd(NEW.source, NEW.price, NEW.price_display);
  NEW.price_confidence := public.price_confidence_for(NEW.price_vnd, NEW.described_price_min_vnd, NEW.described_price_max_vnd);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS external_properties_canonical_sync ON public.external_properties;
CREATE TRIGGER external_properties_canonical_sync
  BEFORE INSERT OR UPDATE OF rooms, size, location, city, price, price_display, source,
    described_price_min_vnd, described_price_max_vnd
  ON public.external_properties
  FOR EACH ROW EXECUTE FUNCTION public.sync_canonical_listing_fields();

-- The one-argument version is replaced, not overloaded: a leftover
-- price_confidence_for(integer) would keep answering from the band alone for
-- anyone who called it. The trigger above no longer does. Nothing in the
-- migrations depends on it, but the live schema is edited outside them, and a
-- failed drop would abort every migration queued behind this one - so a
-- dependant leaves it in place with a notice instead.
DO $$
BEGIN
  DROP FUNCTION IF EXISTS public.price_confidence_for(integer);
EXCEPTION WHEN dependent_objects_still_exist THEN
  RAISE NOTICE 'price_confidence_for(integer) kept: %', SQLERRM;
END
$$;

-- Every 30 minutes, clear of the crawl's :00/:30 and verification's */20.
SELECT cron.unschedule('price-crosscheck')
WHERE EXISTS (
  SELECT 1 FROM cron.job
  WHERE jobname = 'price-crosscheck' AND username = current_user
);

SELECT cron.schedule(
  'price-crosscheck',
  '7,37 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://gbgrwjdmytaksrztcyzs.supabase.co/functions/v1/price-crosscheck',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
