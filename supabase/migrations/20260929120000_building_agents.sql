-- A building's agents (PLAN-v3 S7.0). Additive, replay-safe.
--
-- An availability request is answered by asking the agents who hold units in
-- that building. On 2026-09-29, 12 of 23 buildings had no known agent. Agents
-- who have listed in a building are found from their listings; this table holds
-- the ones an operator adds - met in the building's groups, or the management
-- company's leasing desk.

CREATE TABLE IF NOT EXISTS public.complex_agents (
  complex_id uuid NOT NULL REFERENCES public.complexes(id) ON DELETE CASCADE,
  realtor_id uuid NOT NULL REFERENCES public.realtors(id) ON DELETE CASCADE,
  -- LISTING is derived, never stored (viewing-domain.ts BUILDING_AGENT_SOURCES).
  source text NOT NULL CHECK (source IN ('MANUAL', 'MANAGEMENT')),
  note text CHECK (note IS NULL OR length(note) <= 500),
  -- OPS:<uuid>, or AGENT:<version> should the AI operator ever add one.
  added_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (complex_id, realtor_id)
);

CREATE INDEX IF NOT EXISTS idx_complex_agents_realtor ON public.complex_agents (realtor_id);

-- Written through ops-record-outcome with the service role; read through
-- ops_building_roster(). Nothing reads the table directly.
ALTER TABLE public.complex_agents ENABLE ROW LEVEL SECURITY;

-- Every published building with its agents: the ones added here, and the ones
-- who have listed there (same name-or-alias match as complex_listing_ids()).
-- Agent phones are fine in the ops console - it is renters' contact that must
-- never reach it (invariant 4). Buildings with requests come first.
CREATE OR REPLACE FUNCTION public.ops_building_roster()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _out jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'ops'::app_role) OR public.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'ops role required' USING ERRCODE = '42501';
  END IF;

  WITH b AS (
    SELECT id, name, slug, district, management_company, aliases FROM public.complexes WHERE is_published
  ), terms AS (
    SELECT b.id AS cid, lower(btrim(t)) AS t
    FROM b, unnest(array_prepend(b.name, coalesce(b.aliases, '{}'::text[]))) AS t
    WHERE length(btrim(t)) >= 3
  ), listed AS (
    SELECT tm.cid, e.realtor_id, count(DISTINCT e.id) AS listings,
           max(coalesce(e.crawled_at, e.created_at)) AS last_listed_at
    FROM terms tm
    JOIN public.external_properties e
      ON e.raw_only = false AND e.realtor_id IS NOT NULL
     AND (strpos(lower(coalesce(e.title, '')), tm.t) > 0 OR strpos(lower(coalesce(e.location, '')), tm.t) > 0)
    GROUP BY tm.cid, e.realtor_id
  ), agents AS (
    SELECT cid, realtor_id FROM listed
    UNION
    SELECT complex_id, realtor_id FROM public.complex_agents
  ), citywide AS (
    -- An agency's site lists everywhere; one number across 70 listings is a
    -- desk, not someone who holds units in this building. Shown, not hidden.
    SELECT realtor_id, count(*) AS listings_total
    FROM public.external_properties WHERE realtor_id IS NOT NULL AND raw_only = false GROUP BY realtor_id
  ), replies AS (
    SELECT realtor_id, max(created_at) AS last_reply_at
    FROM public.realtor_messages WHERE direction = 'IN' AND realtor_id IS NOT NULL GROUP BY realtor_id
  ), requests AS (
    SELECT complex_id, count(*) AS n, max(created_at) AS last_at
    FROM public.complex_inquiries
    WHERE channel = 'EMAIL' OR whatsapp_confirmed_at IS NOT NULL
    GROUP BY complex_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'name', b.name, 'slug', b.slug, 'district', b.district,
    'management_company', b.management_company,
    'requests', coalesce(rq.n, 0), 'last_request_at', rq.last_at,
    'agents', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'realtor_id', r.id, 'name', r.display_name, 'agency', r.agency, 'phone', r.phone_e164,
        'sources', array_remove(ARRAY[CASE WHEN l.realtor_id IS NOT NULL THEN 'LISTING' END, ca.source], NULL),
        'note', ca.note, 'added_at', ca.created_at,
        'listings', coalesce(l.listings, 0), 'listings_total', coalesce(cw.listings_total, 0),
        'last_listed_at', l.last_listed_at, 'last_reply_at', rp.last_reply_at
      ) ORDER BY rp.last_reply_at DESC NULLS LAST, l.last_listed_at DESC NULLS LAST)
      FROM agents a
      JOIN public.realtors r ON r.id = a.realtor_id
      LEFT JOIN listed l ON l.cid = a.cid AND l.realtor_id = a.realtor_id
      LEFT JOIN public.complex_agents ca ON ca.complex_id = a.cid AND ca.realtor_id = a.realtor_id
      LEFT JOIN citywide cw ON cw.realtor_id = a.realtor_id
      LEFT JOIN replies rp ON rp.realtor_id = a.realtor_id
      WHERE a.cid = b.id
    ), '[]'::jsonb)
  ) ORDER BY coalesce(rq.n, 0) DESC, b.name), '[]'::jsonb)
  INTO _out
  FROM b LEFT JOIN requests rq ON rq.complex_id = b.id;

  RETURN _out;
END;
$function$;

REVOKE ALL ON FUNCTION public.ops_building_roster() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_building_roster() TO authenticated;
