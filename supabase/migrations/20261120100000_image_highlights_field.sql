-- Egress: public-property-search read `vibe_analysis->image_analyses` for every
-- listing it served, ~7 KB a row (6.7 MB across the active catalogue), to keep
-- one short string per photo. Together with reading the whole catalogue on
-- every page, that was most of the egress that got the free plan restricted
-- again on 2026-11-19.
--
-- `image_highlights` is a PostgREST computed field: select it like a column
-- (`?select=id,image_highlights`) and only the strings leave the database,
-- ~0.4 KB a row. Same rule as the function's old TypeScript,
-- `String(a?.image_highlight || a?.highlight || '')` per element, in order;
-- anything that is not an array gives an empty one.
--
-- Additive and replay-safe. The function falls back to `image_analyses` while
-- this is missing, so the deploy order does not matter.

CREATE OR REPLACE FUNCTION public.image_highlights(public.external_properties)
RETURNS text[]
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT coalesce(array_agg(
           coalesce(nullif(a.v->>'image_highlight', ''), nullif(a.v->>'highlight', ''), '')
           ORDER BY a.ord), '{}')
    FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof($1.vibe_analysis->'image_analyses') = 'array'
                THEN $1.vibe_analysis->'image_analyses' ELSE '[]'::jsonb END
         ) WITH ORDINALITY AS a(v, ord)
$$;

CREATE OR REPLACE FUNCTION public.image_highlights(public.properties)
RETURNS text[]
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT coalesce(array_agg(
           coalesce(nullif(a.v->>'image_highlight', ''), nullif(a.v->>'highlight', ''), '')
           ORDER BY a.ord), '{}')
    FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof($1.vibe_analysis->'image_analyses') = 'array'
                THEN $1.vibe_analysis->'image_analyses' ELSE '[]'::jsonb END
         ) WITH ORDINALITY AS a(v, ord)
$$;

-- For the service role, which is what public-property-search reads with.
REVOKE ALL ON FUNCTION public.image_highlights(public.external_properties) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.image_highlights(public.properties) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.image_highlights(public.external_properties) TO service_role;
GRANT EXECUTE ON FUNCTION public.image_highlights(public.properties) TO service_role;

NOTIFY pgrst, 'reload schema';
