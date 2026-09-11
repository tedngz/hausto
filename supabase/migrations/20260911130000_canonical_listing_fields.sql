-- S3: canonical columns beside the free-text ones (SPEC §0).
--
-- `rooms`, `size` and `location` are whatever the source wrote. None of them
-- can be filtered, compared or trusted:
--
--   rooms     '2 Bedrooms', 'Studio', '4+ Bedrooms', 'Penthouse', and on 17
--             rows a bedroom count sitting in the `size` column instead
--   size      '76 m²', '83', 'N/A', 'Not specified', '97,51 m²' (comma decimal)
--   location  prose, Vietnamese or English depending on source, sometimes
--             degrading to a bare 'Hồ Chí Minh'
--
-- The parsers live in SQL rather than in the crawler because five different
-- writers touch this table (scrape-marketplace, recrawl-external-listing,
-- verify-external-listings and two backfills). A trigger is the only place that
-- catches all of them.

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

ALTER TABLE public.external_properties
  ADD COLUMN IF NOT EXISTS price_vnd        integer,
  ADD COLUMN IF NOT EXISTS price_confidence text,
  ADD COLUMN IF NOT EXISTS bedrooms         smallint,
  ADD COLUMN IF NOT EXISTS bedrooms_is_min  boolean,
  ADD COLUMN IF NOT EXISTS area_sqm         numeric,
  ADD COLUMN IF NOT EXISTS district_code    text;

-- ── bedrooms ────────────────────────────────────────────────────────────────
-- 'Studio' is 0, not unknown - a studio genuinely has no separate bedroom, and
-- mapping it to NULL would drop 82 rows out of every bedroom filter.
-- 'Penthouse' and 'Shared Room' say nothing about a count and stay NULL.
-- Two scalar functions rather than one RETURNS TABLE. An UPDATE cannot reference
-- its own target table from a LATERAL call in its FROM clause - PostgreSQL
-- rejects it with "invalid reference to FROM-clause entry" (42P10) - so the
-- backfill at the bottom could not call a composite-returning version at all.
CREATE OR REPLACE FUNCTION public.parse_bedrooms(_rooms text)
RETURNS smallint
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _rooms IS NULL THEN NULL
    WHEN lower(_rooms) LIKE '%studio%' THEN 0::smallint
    WHEN _rooms ~ '^\s*(\d{1,2})\s*\+?\s*[Bb]edroom' THEN
      least((regexp_match(_rooms, '^\s*(\d{1,2})'))[1]::int, 32767)::smallint
    ELSE NULL
  END;
$$;

-- '4+ Bedrooms' means at least four. Storing it as plain 4 would let a '= 4'
-- filter claim a precision the source never offered.
CREATE OR REPLACE FUNCTION public.parse_bedrooms_is_min(_rooms text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _rooms IS NULL THEN NULL
    WHEN _rooms ~ '^\s*\d{1,2}\s*\+' THEN true
    WHEN lower(_rooms) LIKE '%studio%' OR _rooms ~ '^\s*\d{1,2}\s*[Bb]edroom' THEN false
    ELSE NULL
  END;
$$;

-- ── area ────────────────────────────────────────────────────────────────────
-- Handles '76', '76 m²', '97,51 m²' (Vietnamese decimal comma). Rejects 'N/A',
-- 'Not specified', and the 17 rows carrying a bedroom string in this column.
CREATE OR REPLACE FUNCTION public.parse_area_sqm(_size text)
RETURNS numeric
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _size IS NULL THEN NULL
    WHEN _size ~* 'bedroom|studio|phòng ngủ' THEN NULL
    WHEN _size !~ '^\s*\d' THEN NULL
    ELSE nullif(replace((regexp_match(_size, '^\s*(\d+(?:[.,]\d+)?)'))[1], ',', '.'), '')::numeric
  END;
$$;

-- ── district ────────────────────────────────────────────────────────────────
-- Allowlists, never open-ended capture. `Đường Huyền Thanh Quan` is a street in
-- District 3; a `Huyện (\w+)` pattern turns it into a district called Thanh
-- Quan, and `Quan Alley` into one called Alley. Six rows in this table would
-- have done exactly that.
--
-- Matching runs on unaccented lowercase text, so the function holds no
-- Vietnamese literals at all - which also means it can be tested through
-- scripts/supabase-sql.sh, where Vietnamese in a query does not survive the
-- trip.
CREATE OR REPLACE FUNCTION public.vn_district_code(_city text, _location text)
RETURNS text
LANGUAGE plpgsql STABLE
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  loc text;
  num text;
BEGIN
  IF _location IS NULL OR _city IS NULL THEN RETURN NULL; END IF;
  loc := lower(extensions.unaccent(_location));

  IF _city = 'ho_chi_minh' THEN
    -- Thủ Đức absorbed Districts 2 and 9 in 2021, and listings write it as
    -- "Phường An Lợi Đông (Quận 2 cũ), Thành phố Thủ Đức". The parenthetical is
    -- a FORMER name, so it has to lose to the real one - checked first, or
    -- eight rows land in D2/D9 for a district that no longer exists.
    IF loc LIKE '%thu duc%' THEN RETURN 'THU_DUC'; END IF;

    IF loc LIKE '%binh thanh%'  THEN RETURN 'BINH_THANH'; END IF;
    IF loc LIKE '%go vap%'      THEN RETURN 'GO_VAP'; END IF;
    IF loc LIKE '%tan binh%'    THEN RETURN 'TAN_BINH'; END IF;
    IF loc LIKE '%tan phu%'     THEN RETURN 'TAN_PHU'; END IF;
    IF loc LIKE '%phu nhuan%'   THEN RETURN 'PHU_NHUAN'; END IF;
    IF loc LIKE '%binh tan%'    THEN RETURN 'BINH_TAN'; END IF;
    IF loc LIKE '%nha be%'      THEN RETURN 'NHA_BE'; END IF;
    IF loc LIKE '%binh chanh%'  THEN RETURN 'BINH_CHANH'; END IF;
    IF loc LIKE '%hoc mon%'     THEN RETURN 'HOC_MON'; END IF;
    IF loc LIKE '%cu chi%'      THEN RETURN 'CU_CHI'; END IF;
    IF loc LIKE '%can gio%'     THEN RETURN 'CAN_GIO'; END IF;

    -- Numeric: "quan 7" or housingsgn's English "District 7". Anchored on a
    -- word boundary so "quan" inside a street name cannot start a match.
    num := (regexp_match(loc, '(?:^|[^a-z])(?:quan|district)\s*(\d{1,2})(?:$|[^0-9])'))[1];
    IF num IS NOT NULL AND num::int BETWEEN 1 AND 12 THEN
      RETURN 'D' || num::int;
    END IF;
    RETURN NULL;

  ELSIF _city = 'hanoi' THEN
    IF loc LIKE '%ba dinh%'      THEN RETURN 'BA_DINH'; END IF;
    IF loc LIKE '%cau giay%'     THEN RETURN 'CAU_GIAY'; END IF;
    IF loc LIKE '%dong da%'      THEN RETURN 'DONG_DA'; END IF;
    IF loc LIKE '%hai ba trung%' THEN RETURN 'HAI_BA_TRUNG'; END IF;
    IF loc LIKE '%hoan kiem%'    THEN RETURN 'HOAN_KIEM'; END IF;
    IF loc LIKE '%tay ho%'       THEN RETURN 'TAY_HO'; END IF;
    IF loc LIKE '%nam tu liem%'  THEN RETURN 'NAM_TU_LIEM'; END IF;
    IF loc LIKE '%bac tu liem%'  THEN RETURN 'BAC_TU_LIEM'; END IF;
    IF loc LIKE '%thanh xuan%'   THEN RETURN 'THANH_XUAN'; END IF;
    IF loc LIKE '%long bien%'    THEN RETURN 'LONG_BIEN'; END IF;
    IF loc LIKE '%hoang mai%'    THEN RETURN 'HOANG_MAI'; END IF;
    IF loc LIKE '%ha dong%'      THEN RETURN 'HA_DONG'; END IF;
    IF loc LIKE '%gia lam%'      THEN RETURN 'GIA_LAM'; END IF;
    IF loc LIKE '%hoai duc%'     THEN RETURN 'HOAI_DUC'; END IF;
    RETURN NULL;

  ELSIF _city = 'da_nang' THEN
    IF loc LIKE '%hai chau%'      THEN RETURN 'HAI_CHAU'; END IF;
    IF loc LIKE '%ngu hanh son%'  THEN RETURN 'NGU_HANH_SON'; END IF;
    IF loc LIKE '%son tra%'       THEN RETURN 'SON_TRA'; END IF;
    IF loc LIKE '%thanh khe%'     THEN RETURN 'THANH_KHE'; END IF;
    IF loc LIKE '%lien chieu%'    THEN RETURN 'LIEN_CHIEU'; END IF;
    IF loc LIKE '%cam le%'        THEN RETURN 'CAM_LE'; END IF;
    RETURN NULL;
  END IF;

  RETURN NULL;
END;
$$;

-- ── price ───────────────────────────────────────────────────────────────────
-- `price` is numeric and means different things by source. housingsgn quotes
-- USD and a live row reads `price = 730, price_display = '$730 / month'` - the
-- listing the plan flagged, still in the table. Converting on read is how it
-- stayed wrong; `price_vnd` is the only column money decisions should use.
-- Two rules were tried against the live table before this one, and both were
-- badly wrong. Recorded because either would have been worse than the bug it
-- was fixing:
--
--   "a $ in price_display means price is USD" - it does not. housingsgn rows
--   read `price = 12500000, price_display = '$500/month'`: the number is
--   already converted and the display was never updated. Multiplying those gave
--   312,500,000,000 VND.
--
--   "price < 3,000,000 means USD" - too high a bar. `price = 2800000,
--   '2,8 triệu/tháng'` is a real, cheap rent of 2.8 million dong. That rule
--   turned it into 70 billion.
--
-- Magnitude alone decides, and the threshold sits in the gap between the two
-- currencies rather than at the edge of one: no monthly rent in dong is under
-- 100,000, and no monthly rent in dollars reaches it. Verified across all 703
-- priced rows - resulting range 2.3M to 184M, no outliers either side.
CREATE OR REPLACE FUNCTION public.canonical_price_vnd(_source text, _price numeric, _price_display text)
RETURNS integer
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _price IS NULL OR _price <= 0 THEN NULL
    WHEN _price < 100000 THEN least(round(_price * 25000), 2147483647)::integer
    ELSE least(round(_price), 2147483647)::integer
  END;
$$;

-- A price outside the plausible band is not usable by ops, whatever produced
-- it. This is the cheap half of `price_confidence`; the title/description
-- cross-check SPEC §0 describes is a separate pass and not built yet. Either
-- source of LOW means the same thing downstream: not shortlistable.
CREATE OR REPLACE FUNCTION public.price_confidence_for(_price_vnd integer)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _price_vnd IS NULL THEN NULL
    WHEN _price_vnd BETWEEN 1000000 AND 500000000 THEN 'HIGH'
    ELSE 'LOW'
  END;
$$;

-- ── keep them true on every write ───────────────────────────────────────────
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
  NEW.price_confidence := public.price_confidence_for(NEW.price_vnd);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS external_properties_canonical_sync ON public.external_properties;
CREATE TRIGGER external_properties_canonical_sync
  BEFORE INSERT OR UPDATE OF rooms, size, location, city, price, price_display, source
  ON public.external_properties
  FOR EACH ROW EXECUTE FUNCTION public.sync_canonical_listing_fields();

-- Backfill. The trigger only fires on the listed columns, so existing rows need
-- an explicit pass.
UPDATE public.external_properties p
SET bedrooms        = public.parse_bedrooms(p.rooms),
    bedrooms_is_min = public.parse_bedrooms_is_min(p.rooms),
    area_sqm        = public.parse_area_sqm(p.size),
    district_code   = public.vn_district_code(p.city, p.location),
    price_vnd        = public.canonical_price_vnd(p.source, p.price, p.price_display),
    price_confidence = public.price_confidence_for(public.canonical_price_vnd(p.source, p.price, p.price_display))
WHERE true;

-- Shortlist eligibility, per SPEC §0: enforced by the database, not by whoever
-- remembers to check. Partial so it also serves the ops query that needs it.
CREATE INDEX IF NOT EXISTS external_properties_shortlistable_idx
  ON public.external_properties (city, district_code, bedrooms, price_vnd)
  WHERE is_active
    AND price_vnd IS NOT NULL
    AND bedrooms IS NOT NULL
    AND area_sqm IS NOT NULL
    AND district_code IS NOT NULL
    AND price_confidence = 'HIGH';
