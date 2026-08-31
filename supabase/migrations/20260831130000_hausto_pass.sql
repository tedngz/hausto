-- The Hausto Pass replaces the $10/mo Premium subscription.
--
-- A rental search is a burst - three to six weeks, then it's over - so a
-- recurring subscription was the wrong shape: it billed people past the point
-- they needed it and made cancellation the main support load. The Pass is a
-- one-off $25 purchase good for 30 days, bought again if the search runs long.
--
-- $10 buys a top-up of 2 more viewing coordination. A top-up is not a pass: it
-- grants no entitlements of its own and lapses with the pass that allowed it,
-- so it can never be the thing keeping an account unlocked.
--
-- Shape follows viewing_addons deliberately - one row per purchase, credits
-- spent in place, several rows live at once - because that ledger already
-- behaves correctly under repeat purchase and partial spend. Passes extend
-- rather than overlap: buying early adds 30 days to the end of current cover.

CREATE TABLE IF NOT EXISTS public.passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  renter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 'pass' carries the entitlements; 'topup' only adds viewing credits.
  kind text NOT NULL CHECK (kind IN ('pass', 'topup')),
  paypal_order_id text NOT NULL UNIQUE,
  amount_usd numeric NOT NULL,
  viewings_included integer NOT NULL,
  viewings_used integer NOT NULL DEFAULT 0,
  purchased_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT passes_viewings_used_range
    CHECK (viewings_used >= 0 AND viewings_used <= viewings_included)
);

ALTER TABLE public.passes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Renters can view their own passes" ON public.passes;
CREATE POLICY "Renters can view their own passes"
ON public.passes
FOR SELECT
TO authenticated
USING (auth.uid() = renter_id);

-- Only the capture function (service role) writes passes: a renter who could
-- insert one could grant themselves a pass for free.
REVOKE INSERT, UPDATE, DELETE ON public.passes FROM authenticated, anon;

CREATE INDEX IF NOT EXISTS idx_passes_renter_live
  ON public.passes(renter_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_passes_renter_unspent
  ON public.passes(renter_id, expires_at)
  WHERE viewings_used < viewings_included;

/** True while the renter holds at least one live pass - the entitlement test. */
CREATE OR REPLACE FUNCTION public.has_active_pass(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.passes p
    WHERE p.renter_id = _user_id
      AND p.kind = 'pass'
      AND p.expires_at > now()
  );
$$;

/** When the renter's cover actually runs out - the furthest live pass. */
CREATE OR REPLACE FUNCTION public.active_pass_expires_at(_user_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT MAX(p.expires_at) FROM public.passes p
  WHERE p.renter_id = _user_id
    AND p.kind = 'pass'
    AND p.expires_at > now();
$$;

/** Unspent viewing credits across every live pass and top-up. */
CREATE OR REPLACE FUNCTION public.pass_viewing_credits_remaining(_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(p.viewings_included - p.viewings_used), 0)::int
  FROM public.passes p
  WHERE p.renter_id = _user_id
    AND p.viewings_used < p.viewings_included
    AND p.expires_at > now();
$$;

REVOKE ALL ON FUNCTION public.has_active_pass(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.active_pass_expires_at(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pass_viewing_credits_remaining(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_active_pass(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.active_pass_expires_at(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pass_viewing_credits_remaining(uuid) TO authenticated;

-- Pass credits join the allowance the INSERT policy checks. Legacy Premium
-- subscribers and legacy $20 packs both keep working until they lapse; nothing
-- new is sold into either.
CREATE OR REPLACE FUNCTION public.can_create_fast_track_request(_user_id uuid, _needed integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.base_viewing_allowance_remaining(_user_id)
       + public.viewing_pack_credits_remaining(_user_id)
       + public.pass_viewing_credits_remaining(_user_id)
       >= GREATEST(1, COALESCE(_needed, 1));
$$;

REVOKE ALL ON FUNCTION public.can_create_fast_track_request(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_create_fast_track_request(uuid, integer) TO authenticated;

-- Spending order: plan allowance, then legacy packs, then pass credits.
--
-- Packs go before passes on purpose. They're a retired product with a hard
-- expiry and no way to buy more, so draining them first is the only way their
-- credits don't strand; a pass, by contrast, can be topped up or rebought.
CREATE OR REPLACE FUNCTION public.consume_viewing_pack_credit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  needed integer;
  take integer;
  pack record;
BEGIN
  needed := GREATEST(1, COALESCE(cardinality(NEW.property_ids), 1));
  needed := needed - LEAST(needed, public.base_viewing_allowance_remaining(NEW.renter_id));

  IF needed <= 0 THEN
    RETURN NEW;
  END IF;

  FOR pack IN
    SELECT a.id, a.credits - a.credits_used AS available
    FROM public.viewing_addons a
    WHERE a.renter_id = NEW.renter_id
      AND a.credits_used < a.credits
      AND a.expires_at > now()
    ORDER BY a.expires_at ASC
    FOR UPDATE
  LOOP
    take := LEAST(needed, pack.available);
    UPDATE public.viewing_addons
    SET credits_used = credits_used + take
    WHERE id = pack.id;

    needed := needed - take;
    EXIT WHEN needed <= 0;
  END LOOP;

  -- Then the pass ledger, soonest-lapsing first for the same reason.
  FOR pack IN
    SELECT p.id, p.viewings_included - p.viewings_used AS available
    FROM public.passes p
    WHERE p.renter_id = NEW.renter_id
      AND p.viewings_used < p.viewings_included
      AND p.expires_at > now()
    ORDER BY p.expires_at ASC
    FOR UPDATE
  LOOP
    take := LEAST(needed, pack.available);
    UPDATE public.passes
    SET viewings_used = viewings_used + take
    WHERE id = pack.id;

    needed := needed - take;
    EXIT WHEN needed <= 0;
  END LOOP;

  IF needed > 0 THEN
    RAISE EXCEPTION 'Not enough viewing coordination left on this account';
  END IF;

  RETURN NEW;
END;
$$;
