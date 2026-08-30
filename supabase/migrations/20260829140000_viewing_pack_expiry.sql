-- Viewing packs keep their credits for 30 days from purchase. They are still
-- bought outright and still stack, but an unspent credit lapses with the pack
-- it came from rather than sitting on the account forever.

-- Packs recorded before this (expires_at left null) get 30 days from purchase.
UPDATE public.viewing_addons
SET expires_at = created_at + interval '30 days'
WHERE expires_at IS NULL;

-- Only live packs count towards what the renter can spend.
CREATE OR REPLACE FUNCTION public.viewing_pack_credits_remaining(_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(a.credits - a.credits_used), 0)::int
  FROM public.viewing_addons a
  WHERE a.renter_id = _user_id
    AND a.expires_at > now();
$$;

REVOKE ALL ON FUNCTION public.viewing_pack_credits_remaining(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.viewing_pack_credits_remaining(uuid) TO authenticated;

-- Spend from the pack that lapses soonest, so credits aren't stranded behind a
-- pack bought later. (Was oldest-first, which is the same order until a renter
-- holds two overlapping packs.)
CREATE OR REPLACE FUNCTION public.consume_viewing_pack_credit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target uuid;
BEGIN
  IF public.base_viewing_allowance_remaining(NEW.renter_id) > 0 THEN
    RETURN NEW;
  END IF;

  SELECT a.id INTO target
  FROM public.viewing_addons a
  WHERE a.renter_id = NEW.renter_id
    AND a.credits_used < a.credits
    AND a.expires_at > now()
  ORDER BY a.expires_at ASC
  LIMIT 1
  FOR UPDATE;

  IF target IS NULL THEN
    RAISE EXCEPTION 'No viewing coordination left on this account';
  END IF;

  UPDATE public.viewing_addons
  SET credits_used = credits_used + 1
  WHERE id = target;

  RETURN NEW;
END;
$$;

DROP INDEX IF EXISTS public.idx_viewing_addons_renter_unspent;
CREATE INDEX IF NOT EXISTS idx_viewing_addons_renter_live
  ON public.viewing_addons(renter_id, expires_at)
  WHERE credits_used < credits;
