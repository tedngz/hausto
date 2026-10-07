-- The agent's number on a listing, for a signed-in renter (SPEC §6; owner's
-- decision, 2026-10-07). Additive and replay-safe.
--
-- Hausto is paid by renters only, so the number printed on a crawled ad is no
-- longer something to keep from them: the ad is public on its marketplace, and
-- what the Pass sells is dealing with the agents, not owning their numbers. A
-- renter who would rather call can.
--
-- What this hands over is `contact_phone_e164` - the number the original ad
-- carries, written by the crawler and extract-phone, or resolved by hand
-- against the ad's own masked digits - and the ad's link. Never
-- `realtors.phone_e164`: an agent an operator found (RECORD_CONTACT, building
-- agents, Search for me) agreed to talk to Hausto, not to be published, and
-- reaches a renter only through the viewing-day message with their consent.
--
-- This function is the one path. get-public-property says only whether a
-- number exists (`has_agent_number`); the columns keep no SELECT grant for
-- anon or authenticated. Signing in keeps the numbers away from scrapers and
-- crawlers, and the row each look-up writes is how we learn whether renters
-- call agents themselves or ask us.

CREATE TABLE IF NOT EXISTS public.contact_reveals (
  user_id      uuid NOT NULL,
  listing_id   uuid NOT NULL REFERENCES public.external_properties(id) ON DELETE CASCADE,
  -- The first look-up. Looking again is free and writes nothing.
  revealed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, listing_id)
);

COMMENT ON TABLE public.contact_reveals IS
  'Each listing whose agent number a renter looked up, first time only (reveal_listing_contact, SPEC §6).';

-- Written by reveal_listing_contact only, read with SQL.
ALTER TABLE public.contact_reveals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contact_reveals FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.reveal_listing_contact(_listing_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _l   record;
  -- New listings per account per rolling day. Far past what anyone flat
  -- hunting reads in a day; it is there so an account cannot be a scraper.
  _cap constant integer := 30;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sign_in');
  END IF;

  SELECT contact_phone_e164, source_url INTO _l
  FROM public.external_properties
  WHERE id = _listing_id AND is_active AND raw_only = false;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_listing');
  END IF;
  IF _l.contact_phone_e164 IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_number');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.contact_reveals WHERE user_id = _uid AND listing_id = _listing_id
  ) THEN
    IF (
      SELECT count(*) FROM public.contact_reveals
      WHERE user_id = _uid AND revealed_at > now() - interval '24 hours'
    ) >= _cap THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'daily_limit');
    END IF;
    INSERT INTO public.contact_reveals (user_id, listing_id)
    VALUES (_uid, _listing_id)
    ON CONFLICT (user_id, listing_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'phone_e164', _l.contact_phone_e164,
    'source_url', _l.source_url
  );
END;
$function$;

COMMENT ON FUNCTION public.reveal_listing_contact(uuid) IS
  'The number on a crawled listing''s original ad, and its link, for a signed-in renter. The one path from a listing to its agent (SPEC §6).';

REVOKE ALL ON FUNCTION public.reveal_listing_contact(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reveal_listing_contact(uuid) TO authenticated;
