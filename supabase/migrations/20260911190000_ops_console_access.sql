-- S5, part 2 of 2: what an operator can see, and what they cannot.
--
-- Two decisions shape the whole file.
--
-- **Operators get SELECT and nothing else.** Every write goes through the
-- `ops-record-outcome` edge function holding the service role, which checks the
-- action against the seven in SPEC §4 before writing one typed event. If the
-- console could insert into `events` directly, that check would be advice a
-- browser can decline, and invariant 2 would be a convention rather than a
-- constraint. The corpus is the product here; an eighth outcome invented in a
-- devtools console is a poisoned row nobody notices for a month.
--
-- **The console never sees a renter.** Invariant 4 forbids the renter's phone
-- and name in the realtor view, and the cheapest way to keep a promise like
-- that is to have nothing to leak: no policy below grants `renters` or
-- `messages` (whose `to_phone` is the renter's number). Operators work a
-- request by its `ref`. When S6 needs them to read a renter's reply, that gets
-- a view that selects the body and not the number - not a policy widened here.

-- ── read access, request graph ─────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['viewing_requests','request_items','events','jobs'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Ops read ' || t, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (public.has_role(auth.uid(), ''ops''::app_role))',
      'Ops read ' || t, t);
  END LOOP;
END
$$;

-- ── read access, realtor contact ───────────────────────────────────────────
-- This is the half of the privacy rule that points the other way: the operator
-- rings the broker, so they need the broker's number. What they must never do
-- is put it in renter-facing output, which is enforced where that output is
-- built, not here.
ALTER TABLE public.realtors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Ops read realtors" ON public.realtors;
CREATE POLICY "Ops read realtors" ON public.realtors
  FOR SELECT USING (public.has_role(auth.uid(), 'ops'::app_role));

DROP POLICY IF EXISTS "Admins read realtors" ON public.realtors;
CREATE POLICY "Admins read realtors" ON public.realtors
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::app_role));

-- ── the queue ──────────────────────────────────────────────────────────────
-- What the operator triages by. Note what is absent: a status column. Status is
-- derived by the reducer over `events` (invariant 1), and a status materialised
-- here would be a second implementation of that reducer, drifting from the
-- first the moment either changes. The console loads the log and reduces it -
-- at ~25 requests a day that is free, and it is the only way the two can agree.
--
-- What the view does carry is the things SQL genuinely knows better: counts,
-- and the age that decides what to work next.
CREATE OR REPLACE VIEW public.ops_request_queue
WITH (security_invoker = true) AS
SELECT
  vr.id,
  vr.ref,
  vr.availability,
  vr.created_at,
  -- The SLA clock. Invariant: no request goes more than 24h without the renter
  -- hearing something (S6 asserts it as a property test), so the operator needs
  -- to see the clock rather than compute it per row in the browser.
  EXTRACT(EPOCH FROM (now() - vr.created_at))::bigint AS age_seconds,
  count(ri.id)                                        AS item_count,
  count(ri.id) FILTER (WHERE ri.realtor_id IS NULL)   AS unresolved_realtor_count
FROM public.viewing_requests vr
LEFT JOIN public.request_items ri ON ri.request_id = vr.id
GROUP BY vr.id, vr.ref, vr.availability, vr.created_at;

COMMENT ON VIEW public.ops_request_queue IS
  'Ops triage list. Carries no status - status is derived from events by the reducer (CLAUDE.md invariant 1).';

COMMENT ON VIEW public.ops_request_items_view IS
  'Ops realtor-facing view. Deliberately omits every renters column - see CLAUDE.md invariant 4.';
