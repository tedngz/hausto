-- The Pass digest (pricing rework, build step 4; SPEC §11). Additive and
-- replay-safe (IF NOT EXISTS, upserts, a wrapped cron).
--
-- Pass holders who opted in get new places that fit them up to twice a week:
-- the Tuesday run that already exists, and a Friday run added here. Complex
-- watches keep their weekly alert on both tiers, on Tuesday only.

-- ── Consent, on the account ────────────────────────────────────────────────
-- Ticked on our page before Polar's checkout, so it can arrive before the
-- account has any WhatsApp number. The sweep reads renters.digest_opt_in_at;
-- this is carried onto a number when it is linked (account_link_codes).
CREATE TABLE IF NOT EXISTS public.account_digest_opt_ins (
  user_id      uuid PRIMARY KEY,
  opted_in_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.account_digest_opt_ins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_digest_opt_ins FROM anon, authenticated;

-- ── Linking a number to an account ─────────────────────────────────────────
-- The Pass success page offers a wa.me link carrying one of these. The
-- message it sends proves the number; routing links it to the account, once.
CREATE TABLE IF NOT EXISTS public.account_link_codes (
  code        text PRIMARY KEY CHECK (code ~ '^HL-[34679ACDEFGHJKLMNPQRTWXY]{4}$'),
  user_id     uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  renter_id   uuid REFERENCES public.renters(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_account_link_codes_user ON public.account_link_codes (user_id) WHERE used_at IS NULL;
ALTER TABLE public.account_link_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_link_codes FROM anon, authenticated;

-- ── The Friday run ─────────────────────────────────────────────────────────
-- 02:00 UTC is 09:00 in Ho Chi Minh City, three days after Tuesday's. run: 2
-- is the digest alone, in the new_places wording; until Meta approves that
-- template it reaches only renters whose window is open. Wrapped, like the
-- Tuesday job's, so a cron failure cannot stop the tables being recorded.
DO $$
BEGIN
  PERFORM cron.schedule(
    'viewing-digest-friday',
    '0 2 * * 5',
    $cmd$
  SELECT net.http_post(
    url := 'https://gbgrwjdmytaksrztcyzs.supabase.co/functions/v1/viewing-digest-send',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{"send": true, "run": 2}'::jsonb
  );
  $cmd$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'viewing-digest-friday not scheduled: %', SQLERRM;
END $$;
