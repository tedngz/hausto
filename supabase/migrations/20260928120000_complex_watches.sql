-- Complex watches (SPEC §11): "tell me on WhatsApp when a place comes up at
-- Empire City". Additive only, and replay-safe (IF NOT EXISTS, OR REPLACE).

-- ── The watch ──────────────────────────────────────────────────────────────
-- PENDING until the renter sends its code from their phone, which is the
-- opt-in and the only way renter_id gets set. There is no phone column: the
-- number is whatever phone the code arrived from.
CREATE TABLE IF NOT EXISTS public.complex_watches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complex_id uuid NOT NULL REFERENCES public.complexes(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  -- The account that set it up, if signed in. Linked to the renter on confirm.
  user_id uuid,
  renter_id uuid REFERENCES public.renters(id) ON DELETE SET NULL,
  -- 1-4, where 4 means four or more. NULL is any size.
  bedrooms smallint CHECK (bedrooms BETWEEN 1 AND 4),
  -- Monthly ceiling, integer dong. NULL is any price.
  budget_max_vnd bigint CHECK (budget_max_vnd > 0),
  move_in_by date,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'CANCELLED')),
  confirmed_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_complex_watches_active
  ON public.complex_watches (complex_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_complex_watches_renter
  ON public.complex_watches (renter_id) WHERE renter_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_complex_watches_updated_at ON public.complex_watches;
CREATE TRIGGER set_complex_watches_updated_at
  BEFORE UPDATE ON public.complex_watches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Written by edge functions with the service role only. Admins can read, for
-- the concierge queue; nobody else - it links an account to a renter.
ALTER TABLE public.complex_watches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can read complex watches" ON public.complex_watches;
CREATE POLICY "Admins can read complex watches"
  ON public.complex_watches FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- ── What was put in front of whom ──────────────────────────────────────────
-- One row per listing alerted to a renter, from a watch or the digest. The
-- unique key is what stops a listing being news twice; message_id is how a
-- reply to the template finds the places it was about.
CREATE TABLE IF NOT EXISTS public.alert_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  renter_id uuid NOT NULL REFERENCES public.renters(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES public.external_properties(id) ON DELETE CASCADE,
  watch_id uuid REFERENCES public.complex_watches(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('WATCH', 'DIGEST')),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  -- Set when the places themselves were sent (free-form), not just the count.
  detail_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (renter_id, listing_id)
);

CREATE INDEX IF NOT EXISTS idx_alert_items_message ON public.alert_items (message_id);

ALTER TABLE public.alert_items ENABLE ROW LEVEL SECURITY;

-- ── Which new listings are at a complex ────────────────────────────────────
-- The same rule the complex page uses (get-complex-listings): the name or an
-- alias of 3+ characters appears in the title or location. strpos rather than
-- ILIKE so a name is never read as a pattern.
CREATE OR REPLACE FUNCTION public.complex_listing_ids(_complex_id uuid, _since timestamptz)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH terms AS (
    SELECT DISTINCT lower(btrim(t)) AS t
    FROM public.complexes c,
         unnest(array_prepend(c.name, coalesce(c.aliases, '{}'::text[]))) AS t
    WHERE c.id = _complex_id AND length(btrim(t)) >= 3
  )
  SELECT e.id
  FROM public.external_properties e
  WHERE e.is_active
    AND e.raw_only = false
    AND e.created_at >= _since
    AND EXISTS (
      SELECT 1 FROM terms
      WHERE strpos(lower(coalesce(e.title, '')), terms.t) > 0
         OR strpos(lower(coalesce(e.location, '')), terms.t) > 0
    );
$$;

REVOKE ALL ON FUNCTION public.complex_listing_ids(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complex_listing_ids(uuid, timestamptz) TO service_role;

-- ── Turn the weekly sweep on ───────────────────────────────────────────────
-- The cron posted '{}', which the sweep reads as a dry run - so the digest has
-- never sent. Watches need it to send. The digest still reaches nobody who has
-- not opted in (renters.digest_opt_in_at), and nothing sets that yet. Tuesday
-- 02:00 UTC is 09:00 in Ho Chi Minh City. The job is owned by postgres, which
-- is what db push runs as, but it is wrapped all the same: a failure here must
-- not stop the tables above from being recorded.
DO $$
BEGIN
  PERFORM cron.schedule(
    'viewing-digest-weekly',
    '0 2 * * 2',
    $cmd$
  SELECT net.http_post(
    url := 'https://gbgrwjdmytaksrztcyzs.supabase.co/functions/v1/viewing-digest-send',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{"send": true}'::jsonb
  );
  $cmd$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'viewing-digest-weekly not rescheduled: %', SQLERRM;
END $$;
