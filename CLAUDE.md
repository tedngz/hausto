# Hausto

Two halves. The first is the live platform - crawling, style analysis, image
storage, search, the Pass. The second is the viewing-coordination MVP being
built on top of it, which is what `docs/SPEC.md` and `docs/PLAN-v3.md` describe.

Read `docs/SPEC.md` before touching the viewing domain model. Read
`docs/PLAN-v3.md` for the current milestone and its acceptance criteria. The
second half of this file, from "Shipping changes to production" down, is about
the live platform and applies to everything.

Supabase project ref: `gbgrwjdmytaksrztcyzs`.

## The viewing-coordination MVP

A renter shortlists 1-5 crawled rental listings in Ho Chi Minh City and requests
viewings. An operator confirms availability with each realtor over Zalo - a
person working the ops console, and increasingly the AI operator (SPEC §10),
which proposes every step and may take some alone. The system assembles a
viewing itinerary and delivers it to the renter over WhatsApp. Renter confirms
with one tap.

The renter never has to talk to a realtor, and the realtor never gets the
renter's contact details from us. Everything we handle crosses through us. A
renter who would rather call an agent can, where the ad lists a number
(invariant 4) - what we sell is not having to.

All of it is live: WhatsApp on the Cloud API since 2026-09-18, the ops console
at hausto-ops.vercel.app, and the Zalo bridge since 2026-09-27. PLAN-v3 opens
with where each milestone stands.

### Build on what exists, do not rebuild

The platform already runs on Supabase with a Lovable-built React SPA at
hausto.com. Crawling, style analysis, image storage, dedup, verification and the
public search API are live. Do not stand up a new Next.js app, a new database, or
a new ORM. Everything below is additive.

- Postgres: the existing Supabase database. New tables only; do not restructure
  `external_properties` beyond the additive columns in SPEC §0.
- Backend: Supabase Edge Functions (Deno/TS). The WhatsApp webhook, send service
  and ops mutations all live here.
- Scheduling: `pg_cron` + a `jobs` table. No Inngest, Trigger.dev, BullMQ, Redis.
  Volume is ~25 requests/day.
- Renter UI: the existing Lovable SPA. Add shortlist and request-intake screens
  there.
- Ops console: a separate small Vite + React app behind Supabase Auth with an
  `ops` role and RLS. Keep it out of the renter SPA - different auth surface,
  different deploy cadence, and it should stay ugly and fast.
- `public-property-search` is a stable contract. It serves AI crawlers
  (llms.txt/AEO) and the WhatsApp agent's follow-up search
  (`viewing-agent-search`). Extend it additively; never break its response
  shape.

### Non-negotiable invariants

**1. All state transitions go through the event log.**
`events` is append-only. Every status field on `viewing_requests` and
`request_items` is derived by a reducer over events, never written directly by
UI code. If you find yourself writing `UPDATE request_items SET status = ...`
outside the reducer, stop.

**2. Operators never free-text an outcome.**
The ops console exposes a fixed set of seven outcome actions (SPEC §4). Each
writes a typed event. Free text goes in an optional `note` that is never parsed
and never affects state. This constraint is the whole point - it is how we
generate the training data to automate the realtor side later.

**3. Every outbound message is persisted before it is sent.**
Write to `messages` with `status='QUEUED'`, then send, then update. Never send
first. Idempotency key on every send.

**4. Never expose a renter's phone number or name to an agent or to the ops
console realtor view. An agent's number reaches a renter by exactly two
paths.** Enforce at the query layer, not the template layer (SPEC §6).

- The number printed on a crawled listing's own ad, and the ad's link, on that
  listing's page for a signed-in renter: `reveal_listing_contact`, which logs
  each look-up in `contact_reveals`. Owner's decision, 2026-10-07: Hausto is
  paid by renters only, and the ad is public anyway. It reads
  `external_properties.contact_phone_e164` and never `realtors.phone_e164`.
- Any agent's number on the day of a viewing the renter kept, with that agent's
  consent: `dayStops` in `_shared/viewing/viewing-day.ts`, whose only caller is
  the viewing-day message (owner's decision, 2026-09-30).

An agent an operator found - `RECORD_CONTACT`, building agents, Search for me -
agreed to talk to Hausto, not to be published, so only the second path carries
their number. Do not add a third. The chat, WhatsApp, cards, Browse and the
previews carry no number and link nowhere outside Hausto;
`get-public-property` returns only `has_agent_number`; the contacts functions
answer admins only; and `public-property-search` returns `source_url` as null.

**5. Partial success is the happy path.**
Any code that assumes all requested listings will be confirmed is wrong. Three of
five is the normal outcome. Design every function signature and every UI state
around it.

**6. No `booking` vocabulary in renter-facing copy until state is CONFIRMED.**
Use "request". We cannot honour a booking at intake time.

**7. Today and tomorrow are never offerable.**
`MIN_LEAD_DAYS` in `_shared/viewing/intake.ts`. An operator has to reach every
agent by hand, on Zalo, and wait for each to answer. A request filed at 6pm for
tomorrow morning is one nobody can fill. The rule lives beside `MAX_DAYS_AHEAD`
in the shared module rather than in the date picker, so a client cannot offer
a window the function will refuse.

**8. One way to ask for a viewing.**
Cards carry a single "Request viewing" button, which opens
`RequestViewingModal`. "Shortlist" and "Book viewing" used to sit side by side
and asked the renter to care about a distinction that was ours. Fast-Track is
retired as a renter surface, and since the pricing rework no screen opens its
scheduler; its plumbing stays for history. The modal requests the place it was
opened from (or the places selected in Browse); a place asked for while a
request's agents are still being asked joins that request (`pickJoinable` in
`intake.ts`, SPEC §1), so several requests make one plan and one itinerary
message rather than one each. Past that, a new request waits: one request
being worked at a time, for everyone (`pickBlocking`).

**9. New-flow requests are visible to operators, never to realtors.**
`ViewingFlowQueuePanel` is admin scope only and read-only - status is derived
and outcomes are the seven fixed actions in the ops console.
`ViewingRequestsManager` resolves renter profiles for its realtor scope, so
feeding it `viewing_requests` would put a renter's identity in front of an
agent. That is invariant 4, and it is the whole product.

**10. The AI operator has no write path of its own.**
Everything it does is a call in `_shared/viewing/ops-actions.ts`
(`performOpsAction`), the same code the console's buttons reach through
`ops-record-outcome`, stamped `AGENT:<version>` instead of `OPS:<uuid>`. So
invariants 1-4 bind it exactly as they bind a person. Anything it does alone
passes three locks in `_shared/viewing/autonomy.ts` - the
`AI_OPERATOR_AUTONOMY` secret, the console's pause, and a gate measured from
people's decisions - and anything that messages an agent opens only while
`REALTOR_CHANNEL=bridge`. Do not add a second implementation of an action for
it, and do not add an action to `AUTONOMOUS_ACTIONS` without its own gate.

### The WhatsApp adapter

`supabase/functions/_shared/whatsapp/adapter.ts` exports a `WhatsAppAdapter`
interface with two implementations:

- `MockAdapter` - writes to `messages`, renders in `/dev/phone`, a fake WhatsApp
  thread UI. Inbound simulated by a text box on that page. The default in dev and
  in all tests.
- `CloudApiAdapter` - Meta Graph API. Enabled by `WHATSAPP_MODE=cloud`.

Production runs `CloudApiAdapter`: Meta verification, the number and all five
templates were done by 2026-09-18 (`docs/whatsapp-go-live.md`). That makes
`/dev/phone` unavailable in production, and every change to renter-facing copy
reaches real people on merge. The rules stay in `_shared/whatsapp/send.ts`, so
they do not depend on the transport.

New work must still be fully demoable on `MockAdapter`. If a change's
acceptance criteria cannot be met without real Meta credentials, it is wrongly
scoped - say so rather than stubbing around it.

### Message-window rules the code must respect

The Cloud API 24-hour customer service window is a real constraint, not a detail.

- `renters.service_window_expires_at` is updated on every inbound message.
- `sendFreeForm()` throws if the window is closed. It does not silently fall
  back.
- Re-opening a closed window requires `sendTemplate()`, which only accepts
  template names from the approved registry in `_shared/whatsapp/templates.ts`,
  and only while Meta's live status (synced hourly) still says `APPROVED`.
- From 2026-10-01 Meta bills service and utility messages sent inside the window.
  Consolidate: one message carrying a full itinerary, not a sequence of turns.
  Any code path that sends 3+ messages in a row to the same renter is a bug.

### Out of scope for the MVP

Do not build these even if they seem natural:

- Route/traffic optimization. Ops orders the itinerary by hand; they know the
  city.
- Calendar sync (ICS, Google Calendar).
- Zalo OA or ZNS - they need a Vietnam-registered entity. The one Zalo
  integration that exists is the bridge (`bridge/`, stage 3 of the AI operator
  plan): a daemon on an always-on device that sends approved messages from the
  business's Zalo account and forwards agents' replies. The owner chose it on
  2026-09-27, knowing it automates a personal account against Zalo's terms.
  Build nothing that disguises that automation, and nothing that reads chats
  beyond the agents Hausto is talking to.
- Realtor-facing accounts, login, or portal.
- Renter authentication beyond Supabase auth on the request surface. Intake
  requires a signed-in user, because plans are locked in and request limits
  counted per account; the phone number stays the identity for
  everything inbound, since a WhatsApp message arrives with nothing else to key
  on. `renters.user_id` links the two and is nullable - a renter who arrived
  over WhatsApp and never signed up is still a renter.
- i18n framework. Renter UI is English only. Vietnamese strings are data, not UI.
- Geocoding. Few active listings have coordinates (17 of 180 on 2026-09-28) and
  the viewing flow does not need them; district-clash warnings run off
  `district_code`.

**Payments are not on this list.** They are live and shipping - see the Payments
section below. Since the pricing rework (2026-10-06) requests are free and the
renter pays to **lock in** a plan agents have confirmed: the first viewing on
us, once per WhatsApp number, then the Pass, which covers every confirmed
viewing for 30 days (SPEC §9). The Pass is the one product; build no other
payment surface for the viewing flow. Hausto is paid by renters only (owner's
decision, 2026-10-07): no referral share from agents, so build nothing to
track one.

### Conventions

- Money in VND, stored as integer dong. Never floats. Display `15.000.000 ₫`.
  Note `external_properties.price` is `numeric` and holds USD for housingsgn
  rows; the canonical column is `price_vnd` (SPEC §0).
- All timestamps stored UTC, displayed `Asia/Ho_Chi_Minh`.
- Phone numbers stored E.164. Normalize at every boundary; the crawler will hand
  you `0901234567`, `84901234567`, and `+84 90 123 45 67` for the same human.
  Agents are `+84` only (`toE164`); renters may be on any country's number
  (`toRenterE164` for what they type, `waIdToE164` for what Meta sends), so a
  privacy check never assumes `+84` - see SPEC §6.
- Enum values SCREAMING_SNAKE in the DB, mirrored as TS union types derived
  from a single source: the `as const` arrays in
  `supabase/functions/_shared/viewing-domain.ts`, beside the reducer. There is
  no `lib/` directory.
- Use `-` rather than an em dash in anything a user reads.

### Definition of done for any MVP task

1. Types check, lint passes. Edge functions are Deno and are not covered by
   `tsconfig.app.json`, so `tsc --noEmit` says nothing about them.
2. Reducer tests cover every new event type, including out-of-order arrival.
3. The path is demoable end to end on `MockAdapter` with seeded data.
4. `docs/SPEC.md` updated if the domain model changed.
5. If it touched renter-facing copy, you have read it:
   `REHEARSAL_PRINT=1 npx vitest run rehearsal` prints the whole conversation.
   No assertion catches copy that is correct and reads badly, and `/dev/phone`
   stops being available the moment `WHATSAPP_MODE=cloud`.

---

# Shipping changes to production

Notes on how changes reach production. Everything here is something that looked
fine locally and went wrong on the way out.

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

**`DROP FUNCTION IF EXISTS` matches on the argument list, not the name.** Naming
a function with empty parens when it takes arguments drops nothing, succeeds,
and reports success - so the drop looks done and the function is still there:

```sql
DROP FUNCTION IF EXISTS public.get_post_authors_profiles();            -- no-op
DROP FUNCTION IF EXISTS public.get_post_authors_profiles(uuid[]);      -- drops it
```

Get the signatures first, and check afterwards that they are gone. Overloads
mean one name can need several drops:

```sh
echo "SELECT p.proname, pg_get_function_identity_arguments(p.oid)
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname ILIKE '%<name>%';" | bash scripts/supabase-sql.sh
```

**A migration cannot touch a cron job owned by another role.** `db push` runs as
`postgres`, and `cron.unschedule(name)` only matches jobs whose owner is the
calling role. Against a job owned by anyone else it fails with a message that
reads like the job does not exist:

```
ERROR: could not find valid entry for job 'auto-crawl-v2' (SQLSTATE XX000)
```

Deleting the row directly is no better - `cron.job` is owned by `supabase_admin`
and `postgres` has no `DELETE` on it. Nor can you borrow the owner: `postgres`
is not a superuser and cannot `SET ROLE` to another owner such as
`supabase_read_only_user`, so the SQL Editor fails the same way. Check the
owner before writing the migration:

```sh
echo "SELECT jobid, jobname, username FROM cron.job ORDER BY jobname;" | bash scripts/supabase-sql.sh
```

If it is not `postgres`, try the dashboard's Cron page, and if that refuses
too, only Supabase support can remove it: ask them to run
`SELECT cron.unschedule(<jobid>);` as `supabase_admin`. That is where
`auto-crawl-v2` (jobid 7) stands - see PLAN-v3 S1 item 2.

A failing statement aborts the whole push, so **the migrations queued behind it
never run** - and they are not recorded, so the next push retries them. Wrap
anything that can fail on permissions in a `DO ... EXCEPTION` block.

More generally: `scripts/supabase-sql.sh` returns `[]` for any statement with no
result set, so `[]` means "nothing to report", never "it worked". Confirm
destructive SQL by re-reading the catalog rather than by its exit code.

## Edge functions: deployed by CI, never by hand

`.github/workflows/deploy-functions.yml` deploys on merge to `main` when
`supabase/functions/**` or `supabase/config.toml` changes. That workflow exists
to end hand-deploys - a hand-pushed function leaves production running code no
commit describes. Merge the PR instead of running `supabase functions deploy`.

Three things it does not do:

- **It never deletes.** Removing a function's directory leaves the deployed
  copy live and callable. Retiring one needs
  `npx supabase functions delete <slug> --project-ref gbgrwjdmytaksrztcyzs`.
  Since #104 the run fails, naming it, while any deployed function has no
  directory in `supabase/functions/` - so the next deploy after a removal goes
  red until the delete is done. A failed deploy is retried once per function
  (#103).
- **It does not add config.** A new function needs a `supabase/config.toml`
  entry. Anything a third party calls (a payment webhook, say) needs
  `verify_jwt = false`, or the request is rejected before it reaches the code.
- **It skips `_shared`.** Directories starting with `_` are library code,
  bundled into their callers rather than deployed.

Edge functions are Deno and are not covered by `tsconfig.app.json`, so
`tsc --noEmit` says nothing about them. CI catches syntax errors only when the
deploy bundles them, which is after merge.

## The other two deploy targets

- **The ops console** deploys to Vercel (`hausto-ops`, served at
  https://hausto-ops.vercel.app) through `.github/workflows/deploy-ops.yml`, on
  merge to `main` when `ops/` or `supabase/functions/_shared/` changes - the
  console imports the reducer from there. It needs a `VERCEL_TOKEN` repository
  secret and skips with a notice without one. See `ops/README.md`.
- **The Zalo bridge** is not deployed by CI at all. It runs on a VPS and is
  updated by hand with `bash bridge/deploy/deploy.sh`, which replaces the code
  and keeps the Zalo login and the send journal. See `bridge/README.md`. The
  edge-function half of it (`zalo-bridge`) deploys like any other function.

The renter SPA publishes from Lovable, not from a workflow.

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

Edge function logs go back about 24 hours. Every source sits in one `logs`
table, filtered by `source` (`function_logs` for `console.log` output,
`function_edge_logs` for one line per request, `postgres_logs`, `edge_logs`).
The old `logs.all` endpoint and per-source tables such as `function_logs` were
removed. Pass a time window: without one the endpoint answers
"Backend error! Retry your query" rather than a useful error.

```sh
TOKEN=$(cat "$HOME/.supabase/access-token") node -e "
const u=new URL('https://api.supabase.com/v1/projects/gbgrwjdmytaksrztcyzs/analytics/endpoints/logs');
u.searchParams.set('iso_timestamp_start', new Date(Date.now()-3600e3).toISOString());
u.searchParams.set('iso_timestamp_end', new Date().toISOString());
u.searchParams.set('sql',\"select timestamp, event_message from logs where source='function_logs' order by timestamp desc limit 100\");
fetch(u,{headers:{Authorization:'Bearer '+process.env.TOKEN}}).then(r=>r.json()).then(b=>
  (b.result||[]).reverse().forEach(r=>console.log(r.timestamp, r.event_message)));
"
```

The window is capped at 24 hours. Narrow by function with
`position(event_message, '[verify-external-listings]') > 0`.

The access token is at `~/.supabase/access-token`, not under `$APPDATA`.

## Stacked pull requests

A PR whose base is another PR's branch is **closed automatically when that base
branch is deleted** - and `gh pr merge --delete-branch` deletes it. The stacked
PR does not retarget itself; it closes, and a closed PR cannot have its base
changed, so it cannot simply be reopened onto `main`.

Merging the bottom of a stack, in order:

```sh
gh pr edit <top> --base main      # retarget FIRST, while the base still exists
gh pr merge <bottom> --squash --delete-branch
```

If it has already happened, nothing is lost - the branch and its commits
survive. Replay just the commits that were not in the merge, then open a fresh
PR:

```sh
git rebase --onto origin/main <sha of the merged tip> <your branch>
```

Avoiding the stack is usually easier: unrelated work belongs on its own branch
cut from `main`. Stacking is worth it only when the second change genuinely does
not compile or apply without the first.

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

**Two request tables are that same hazard in a different shape.** Fast-Track
(`fast_track_requests`) is retired as a renter surface but its rows are real
history, and the viewing flow writes `viewing_requests` + `request_items`.
`viewing_listings_booked_since()` exists so a listing is counted once,
whichever table it was requested through, and
`base_viewing_allowance_remaining` calls it rather than counting either table
itself. Counting only one would give a complimentary-cover account three
coordinations from each.

Since the pricing rework the viewing flow spends no credits at all, and the
credit ledger - `passes.viewings_used`, `consume_viewing_credits()`,
`viewing_trials` - is history. Fast-Track's trigger still charges it, and no
screen opens Fast-Track any more. What the viewing flow charges is the lock-in,
and **one function decides cover** - `decideLockIn` in
`_shared/viewing/lock-in.ts` - for the lock-in page, the payment and a
WhatsApp "yes" alike:

- The Pass covers every stop. `has_active_pass` or `has_complimentary_pass`,
  read at lock-in, not at request.
- The free viewing covers one stop, once per WhatsApp number, claimed in
  `free_viewings` (primary key on the number) at lock-in.
- A Pass bought from the lock-in page carries the request in its checkout's log
  (`LOCK_IN_CHECKOUT_OPENED`), and `_shared/polar-pass.ts` locks the plan in
  where the purchase is recorded, on both paths. The number to watch: lock-ins
  with no Pass and no free viewing - always zero.

Search for me - an availability request for an area rather than a building
(SPEC §11) - is the Pass's too, read the same way (`hasPassCover`) when the
request is made, one open search per account. A building request stays free
for everyone; it is what fills the agent roster.
