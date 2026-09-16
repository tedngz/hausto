# Hausto

Rental viewing coordination for Ho Chi Minh City.

A renter shortlists up to five crawled listings and asks to see them. A human
operator working Zalo confirms availability with each agent. We assemble a
viewing itinerary and send it over WhatsApp, in one message. The renter
confirms with one tap.

**The renter never talks to an agent. The agent never sees the renter's contact
details. Everything crosses through us.** That is the product, and it is
enforced in the query layer rather than in templates.

## Two halves

**The live platform.** Crawling, style analysis, image storage, dedup,
verification, the public search API, and the Pass. This has been running and is
what the viewing flow is built on top of.

**The viewing-coordination MVP.** `docs/SPEC.md` is the domain model,
`docs/PLAN-v3.md` the milestones. Additive: new tables, new edge functions, new
screens in the existing app. Nothing was rebuilt to accommodate it.

Read `CLAUDE.md` before changing either. It carries the invariants and a long
list of things that looked fine locally and went wrong on the way to
production.

## How a request actually flows

```
renter shortlists 1-5 listings
      │
      ▼
request modal  ─────────►  viewing-request-create
  signed in                  screens listings against what is still live
  calendar, 2-day buffer      charges one viewing credit per listing
      │                       writes request + items + events
      ▼
WhatsApp deep link  ──►  renter messages us, opening the 24-hour window
      │
      ▼
ops console  ─────────►  seven fixed outcomes per listing, never free text
      │
      ▼
itinerary  ───────────►  ONE WhatsApp message carrying every confirmed viewing
      │
      ▼
renter replies YES  ──►  CONFIRMED
```

Three of five confirmed is the normal result, not an error state. Every
signature and every screen is built around partial success.

## Layout

| Path | What it is |
|---|---|
| `src/` | The renter SPA (Vite + React + shadcn). Built by Lovable, edited here too. |
| `ops/` | The operator console. Separate entry, separate build, no route in from the SPA. Meant to stay ugly and fast. |
| `supabase/functions/` | Edge functions (Deno). `_shared/` is library code, bundled into callers rather than deployed. |
| `supabase/functions/_shared/viewing/` | The viewing domain: intake, itinerary, reminders, substitutes, search, selection, the agent. Pure TypeScript, unit tested. |
| `supabase/migrations/` | Schema. Read `CLAUDE.md` before adding one - there are two migration paths here that fight each other. |
| `docs/` | `SPEC.md` (domain model), `PLAN-v3.md` (milestones), `whatsapp-go-live.md` (the Meta checklist). |

## Running it

```sh
npm i
npm run dev        # renter SPA
npm run dev:ops    # operator console
npm test           # 334 unit tests, no browser needed
```

Two things worth knowing before you spend an afternoon on them:

**`npm ci` fails in some environments.** A few hundred lockfile entries resolve
to a Google Artifact Registry mirror that is not always reachable. `rm -rf
node_modules && npm install --no-package-lock` gets you running without
touching `package-lock.json`.

**Edge functions are Deno and are outside `tsconfig.app.json`,** so
`tsc --noEmit` says nothing about them. They are covered by unit tests and by
bundling them with esbuild; CI catches the rest only on deploy, which is after
merge.

### Seeing the renter conversation

The whole WhatsApp exchange runs on a mock adapter and prints:

```sh
REHEARSAL_PRINT=1 npx vitest run rehearsal
```

Worth doing before any change to renter-facing copy. `/dev/phone` is the
interactive version - a fake WhatsApp thread you can type into - and it refuses
to run once `WHATSAPP_MODE=cloud`, because an endpoint that fabricates inbound
messages against a live number is a forgery tool.

## Deploying

Merging to `main` is the deploy.

| Workflow | Fires on | Does |
|---|---|---|
| `deploy-functions.yml` | changes under `supabase/functions/**` | `supabase functions deploy`. Never deletes; a new function needs a `config.toml` entry. |
| `deploy-migrations.yml` | changes under `supabase/migrations/**` | `supabase db push`. Only *lists* on pull requests, so merge is the first real test of a migration. |

The frontend publishes from Lovable (Share → Publish). Edge-function secrets go
in the Supabase dashboard, never from a shell - `CLAUDE.md` records three
separate incidents of a pasted value arriving mangled, and an empty secret is a
valid secret as far as the CLI is concerned.

## Where WhatsApp is up to

The code is done and the adapter is transport-independent. What remains is on
Meta's side: business verification, template approval, and the cutover. The
order to do it in, and how to tell it worked, is `docs/whatsapp-go-live.md`.

Until `WHATSAPP_MODE=cloud`, everything runs on `MockAdapter` and every
milestone is demoable without a single Meta credential. That is deliberate:
a milestone that cannot be demoed on the mock is wrongly scoped.

## Payments

Polar is the processor; PayPal is retired. A viewing request costs one credit
per listing, drawn from the Pass ledger or a windowed allowance - never both,
which is a mistake this codebase has already made once and now guards against
in SQL. See the Payments section of `CLAUDE.md` before touching any of it.

## Project links

- Lovable project: https://lovable.dev/projects/614aa0f7-490d-413a-8576-174e6d3df45e
- Supabase project ref: `gbgrwjdmytaksrztcyzs`
