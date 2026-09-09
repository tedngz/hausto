# Working in this repo

Notes on how changes reach production. Everything here is something that looked
fine locally and went wrong on the way out.

Supabase project ref: `gbgrwjdmytaksrztcyzs`.

## Database migrations: two paths that fight each other

This project has **both** a drifted migration history and a workflow that
pushes migrations. They pull in opposite directions, and reconciling them is
manual.

- `scripts/supabase-sql.sh` runs SQL against the project through the Management
  API. It exists because Lovable applies migrations directly, so local history
  has drifted from remote and `supabase db push` is not safe to trust blindly.
- `.github/workflows/deploy-migrations.yml` runs `supabase db push` on every
  merge to `main` that touches `supabase/migrations/**`.

**If you apply a migration by hand, record it.** `supabase-sql.sh` changes the
schema without writing to `supabase_migrations.schema_migrations`, so the next
`db push` sees the file as pending and replays it against a schema that already
has the change. A `CREATE OR REPLACE` survives that; an `ALTER TABLE ... RENAME`
does not, and the workflow goes red:

```sql
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('20260908130000', 'polar_payments', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
```

**Check the version prefix is unique before naming a file.** Two files sharing
one timestamp breaks `db push` in a way the error message does not explain:

```sh
ls supabase/migrations/ | cut -d_ -f1 | sort | uniq -d   # must print nothing
```

Prefer `CREATE OR REPLACE FUNCTION` and `IF NOT EXISTS` so a replay is
harmless. Read the live definition before rewriting a function - what is
deployed is the source of truth here, not the migration files:

```sh
echo "SELECT pg_get_functiondef(p.oid) FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='<name>';" | bash scripts/supabase-sql.sh
```

## Edge functions: deployed by CI, never by hand

`.github/workflows/deploy-functions.yml` deploys on merge to `main` when
`supabase/functions/**` or `supabase/config.toml` changes. That workflow exists
to end hand-deploys - a hand-pushed function leaves production running code no
commit describes. Merge the PR instead of running `supabase functions deploy`.

Three things it does not do:

- **It never deletes.** Removing a function's directory leaves the deployed
  copy live and callable. Retiring one needs
  `npx supabase functions delete <slug> --project-ref gbgrwjdmytaksrztcyzs`.
- **It does not add config.** A new function needs a `supabase/config.toml`
  entry. Anything a third party calls (a payment webhook, say) needs
  `verify_jwt = false`, or the request is rejected before it reaches the code.
- **It skips `_shared`.** Directories starting with `_` are library code,
  bundled into their callers rather than deployed.

Edge functions are Deno and are not covered by `tsconfig.app.json`, so
`tsc --noEmit` says nothing about them. CI catches syntax errors only when the
deploy bundles them, which is after merge.

## Secrets: set them in the dashboard

Set edge-function secrets at
`https://supabase.com/dashboard/project/gbgrwjdmytaksrztcyzs/settings/functions`.

Setting them from PowerShell has cost real debugging time three separate ways -
`$var` not surviving between terminal sessions and silently expanding to
nothing, and a paste arriving mangled. **An empty or truncated value is a valid
value**: the CLI stores it and reports success, and the failure surfaces much
later as a generic error from whatever consumes it.

`supabase secrets list` returns SHA-256 digests, never values. That is enough to
prove a secret is *not* something, which is the useful check:

```sh
# is it empty?  sha256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
npx supabase secrets list --project-ref gbgrwjdmytaksrztcyzs
```

It cannot prove a secret is *correct* - a one-character value hashes to
something that looks perfectly healthy. Where a secret's shape matters, have the
consuming function log the shape it sees (length, prefix, whether trimming
changed it) but never the value. That is what turned a permanent, unexplained
`bad signature` into a one-line diagnosis.

## Verifying against production

Read state directly rather than inferring it. Entitlements in particular live in
SQL and the client only mirrors them, so check the database when a number looks
wrong:

```sh
echo "SELECT public.base_viewing_allowance_remaining('<uuid>') AS base,
             public.pass_viewing_credits_remaining('<uuid>') AS ledger,
             public.can_create_fast_track_request('<uuid>', 4) AS allows_4;" \
  | bash scripts/supabase-sql.sh
```

Edge function logs are retained for roughly **three minutes**. Catching a
failure means tailing while it is reproduced, not looking afterwards:

```sh
TOKEN=$(cat "$HOME/.supabase/access-token") node -e "
const u=new URL('https://api.supabase.com/v1/projects/gbgrwjdmytaksrztcyzs/analytics/endpoints/logs.all');
u.searchParams.set('sql','select timestamp, event_message from function_logs order by timestamp desc limit 100');
fetch(u,{headers:{Authorization:'Bearer '+process.env.TOKEN}}).then(r=>r.json()).then(b=>
  (b.result||[]).reverse().forEach(r=>console.log(new Date(Number(r.timestamp)/1000).toISOString(), r.event_message)));
"
```

The access token is at `~/.supabase/access-token`, not under `$APPDATA`.

## Payments

Polar is the processor; PayPal is fully retired. Both the `/pass-success`
redirect and the `order.paid` webhook record a purchase, they race, and they
share `supabase/functions/_shared/polar-pass.ts` so the expiry rules cannot
drift apart. Idempotency comes from the unique `passes.provider_order_id`,
which both paths set to the Polar checkout id - whichever writes second finds
the row and reports `already`.

Entitlements must be counted once. A bought pass draws only on the `passes`
ledger; the windowed allowance in `base_viewing_allowance_remaining` is for
holders with no ledger row (complimentary cover, the free trial). Granting both
sold three viewings and permitted six.
