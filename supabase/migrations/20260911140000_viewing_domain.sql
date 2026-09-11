-- S4: the viewing-coordination domain (SPEC §1-§3).
--
-- Six tables, and the one that matters is `events`. Every status on
-- viewing_requests and request_items is DERIVED by a reducer over the log -
-- there are deliberately no status columns to write to, because a status column
-- is an invitation to write to it, and invariant 1 in CLAUDE.md exists because
-- that is how these systems rot.

-- ── renters ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.renters (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164                text UNIQUE NOT NULL,
  display_name              text,
  -- The Cloud API 24-hour window. Updated on every inbound message; sendFreeForm
  -- throws when it has passed rather than silently falling back to a template.
  service_window_expires_at timestamptz,
  opted_out_at              timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT renters_phone_e164_format CHECK (phone_e164 ~ '^\+84[0-9]{9}$')
);

-- ── viewing_requests ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.viewing_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Short, human, sayable over the phone. Generated in app code so the shape
  -- stays in one place; unique here so a collision is an error, not a surprise.
  ref          text UNIQUE NOT NULL,
  renter_id    uuid NOT NULL REFERENCES public.renters(id) ON DELETE CASCADE,
  availability jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS viewing_requests_renter_idx ON public.viewing_requests (renter_id, created_at DESC);

-- ── request_items ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.request_items (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id           uuid NOT NULL REFERENCES public.viewing_requests(id) ON DELETE CASCADE,
  listing_id           uuid NOT NULL REFERENCES public.external_properties(id) ON DELETE RESTRICT,
  realtor_id           uuid REFERENCES public.realtors(id) ON DELETE SET NULL,
  -- What the renter was shown. Without it, "the broker quoted a different price"
  -- is an argument; with it, it is a comparison.
  price_vnd_at_request integer NOT NULL,
  sort_order           smallint,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, listing_id)
);

CREATE INDEX IF NOT EXISTS request_items_request_idx ON public.request_items (request_id);
CREATE INDEX IF NOT EXISTS request_items_realtor_idx ON public.request_items (realtor_id) WHERE realtor_id IS NOT NULL;

-- ── events ─────────────────────────────────────────────────────────────────
-- Append-only. See the REVOKE below: this is enforced by Postgres, not by
-- remembering.
CREATE TABLE IF NOT EXISTS public.events (
  id          bigserial PRIMARY KEY,
  request_id  uuid NOT NULL REFERENCES public.viewing_requests(id) ON DELETE CASCADE,
  item_id     uuid REFERENCES public.request_items(id) ON DELETE CASCADE,
  type        text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- 'OPS:<uuid>' | 'RENTER' | 'SYSTEM'
  actor       text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

-- The reducer's read: one request's log in replay order. `id` breaks ties on
-- occurred_at so a replay is deterministic even when two events share a
-- timestamp - which they will, since several are written in one transaction.
CREATE INDEX IF NOT EXISTS events_replay_idx ON public.events (request_id, occurred_at, id);
CREATE INDEX IF NOT EXISTS events_item_idx ON public.events (item_id, occurred_at, id) WHERE item_id IS NOT NULL;

-- ── messages ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      uuid REFERENCES public.viewing_requests(id) ON DELETE SET NULL,
  direction       text NOT NULL CHECK (direction IN ('OUT', 'IN')),
  channel         text NOT NULL DEFAULT 'WHATSAPP',
  to_phone        text NOT NULL,
  body            text,
  template_name   text,
  status          text NOT NULL CHECK (status IN ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED')),
  -- Persist-then-send lives or dies on this. Derived from
  -- (request_id, purpose, attempt), so a retry cannot double-send.
  idempotency_key text UNIQUE NOT NULL,
  provider_id     text,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz
);

CREATE INDEX IF NOT EXISTS messages_request_idx ON public.messages (request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_pending_idx ON public.messages (status, created_at) WHERE status = 'QUEUED';

-- ── jobs ───────────────────────────────────────────────────────────────────
-- Timers and nudges, drained by pg_cron. No Inngest, no Redis: ~25 requests/day
-- does not need a queue, it needs a table and a cron entry.
CREATE TABLE IF NOT EXISTS public.jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL,
  run_after    timestamptz NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts     smallint NOT NULL DEFAULT 0,
  locked_at    timestamptz,
  completed_at timestamptz,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- The drain's read: what is due, unlocked, unfinished.
CREATE INDEX IF NOT EXISTS jobs_due_idx ON public.jobs (run_after)
  WHERE completed_at IS NULL AND locked_at IS NULL;

-- ── append-only, enforced ──────────────────────────────────────────────────
-- Invariant 1 says events is append-only. A comment saying so is worth nothing
-- once someone is debugging at speed, so the privilege is simply absent. The
-- service role is not exempt - nothing in this system has a legitimate reason
-- to rewrite history, and a correction is a new event.
REVOKE UPDATE, DELETE ON public.events FROM PUBLIC, anon, authenticated, service_role;

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Renter contact details and realtor contact details in the same request graph.
-- Nothing here is renter-readable yet: the renter surface reaches this through
-- edge functions holding the service role, which bypasses RLS, and the ops
-- console gets the `ops` role in S5. Until then, admin only - a default of
-- "nobody" is the right one to start from.
ALTER TABLE public.renters          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.viewing_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs             ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['renters','viewing_requests','request_items','events','messages','jobs'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Admins read ' || t, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (public.has_role(auth.uid(), ''admin''::app_role))',
      'Admins read ' || t, t);
  END LOOP;
END
$$;

-- ── renter privacy, at the query layer ─────────────────────────────────────
-- Invariant 4: the ops realtor view must never see a renter's name or number.
-- Enforcing that in a template is enforcing it nowhere, so the view simply does
-- not select those columns - a careless change to the console cannot leak what
-- it cannot query.
CREATE OR REPLACE VIEW public.ops_request_items_view
WITH (security_invoker = true) AS
SELECT
  ri.id,
  ri.request_id,
  vr.ref            AS request_ref,
  ri.listing_id,
  ri.realtor_id,
  ri.price_vnd_at_request,
  ri.sort_order,
  ri.created_at,
  r.phone_e164      AS realtor_phone,
  r.display_name    AS realtor_name,
  ep.title          AS listing_title,
  ep.source_url     AS listing_url,
  ep.district_code,
  ep.bedrooms,
  ep.area_sqm
FROM public.request_items ri
JOIN public.viewing_requests vr ON vr.id = ri.request_id
LEFT JOIN public.realtors r ON r.id = ri.realtor_id
LEFT JOIN public.external_properties ep ON ep.id = ri.listing_id;

COMMENT ON VIEW public.ops_request_items_view IS
  'Ops realtor-facing view. Deliberately omits every renters column - see CLAUDE.md invariant 4.';
