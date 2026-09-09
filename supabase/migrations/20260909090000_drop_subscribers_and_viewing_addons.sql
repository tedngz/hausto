-- Retire the subscribers and viewing_addons tables.
--
-- Both are products that no longer exist. The $10/mo Premium subscription was
-- replaced by the Hausto Pass and its last cycle lapsed before PayPal was
-- retired; the $20/10-viewing pack was replaced by the pass ledger, which does
-- the same job - one row per purchase, credits spent in place, several live at
-- once - and is the shape viewing_addons was the model for.
--
-- Neither holds anything worth keeping. viewing_addons is empty. subscribers
-- has nine rows and every one of them reads subscribed=false, tier='free',
-- no processor id, no end date: shells created by a signup trigger, not
-- billing history. Nobody was ever billed through it that these rows record.
--
-- passes is now the single ledger for everything bought.

-- ---------------------------------------------------------------- subscribers

-- The signup trigger is the only thing still writing to the table. Dropping it
-- is the behavioural change here: new accounts stop getting a free-tier shell
-- row. Nothing reads it - entitlement comes from passes and user_roles.
DROP TRIGGER IF EXISTS on_auth_user_created_subscriber ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_subscriber();

-- Manual-upgrade helpers for the retired plan. Inert already, since nothing
-- reads `subscribed` for entitlement any more, but they are the last code that
-- talks about a premium tier.
DROP FUNCTION IF EXISTS public.activate_user_subscription(user_email text);
DROP FUNCTION IF EXISTS public.get_user_subscription_status();

-- Its own triggers go with the table, but the function they call does not.
DROP FUNCTION IF EXISTS public.set_subscription_end_on_manual_upgrade() CASCADE;

-- ------------------------------------------------------------ viewing_addons

-- Spending order loses its first stop. Packs went before passes because they
-- were a retired product with a hard expiry and no way to buy more, so draining
-- them first was the only way their credits did not strand. With none left,
-- the pass ledger is the whole of it - still soonest-lapsing first, so a
-- top-up that expires with its pass is spent before a pass bought later.
CREATE OR REPLACE FUNCTION public.consume_viewing_pack_credit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  needed integer;
  take integer;
  entry record;
BEGIN
  needed := GREATEST(1, COALESCE(cardinality(NEW.property_ids), 1));
  needed := needed - LEAST(needed, public.base_viewing_allowance_remaining(NEW.renter_id));

  IF needed <= 0 THEN
    RETURN NEW;
  END IF;

  FOR entry IN
    SELECT p.id, p.viewings_included - p.viewings_used AS available
    FROM public.passes p
    WHERE p.renter_id = NEW.renter_id
      AND p.viewings_used < p.viewings_included
      AND p.expires_at > now()
    ORDER BY p.expires_at ASC
    FOR UPDATE
  LOOP
    take := LEAST(needed, entry.available);
    UPDATE public.passes
    SET viewings_used = viewings_used + take
    WHERE id = entry.id;

    needed := needed - take;
    EXIT WHEN needed <= 0;
  END LOOP;

  IF needed > 0 THEN
    RAISE EXCEPTION 'Not enough viewing coordination left on this account';
  END IF;

  RETURN NEW;
END;
$function$;

-- The allowance gate drops the pack term with it.
CREATE OR REPLACE FUNCTION public.can_create_fast_track_request(_user_id uuid, _needed integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.base_viewing_allowance_remaining(_user_id)
       + public.pass_viewing_credits_remaining(_user_id)
       >= GREATEST(1, COALESCE(_needed, 1));
$$;

DROP FUNCTION IF EXISTS public.viewing_pack_credits_remaining(_user_id uuid);

-- --------------------------------------------------------------------- drop

DROP TABLE IF EXISTS public.subscribers;
DROP TABLE IF EXISTS public.viewing_addons;
