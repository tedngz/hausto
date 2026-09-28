# Hausto

Rental viewing coordination for Ho Chi Minh City.

A renter picks up to five crawled listings and asks to see them. An operator
confirms availability with each agent over Zalo - a person in the ops console,
helped (and, behind locks, partly replaced) by an AI operator. We assemble a
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
`docs/PLAN-v3.md` the milestones and where each one stands. Additive: new
tables, new edge functions, new screens in the existing app, a separate ops
console. Nothing was rebuilt to accommodate it. It is live: WhatsApp on the
Cloud API since 2026-09-18, the Zalo bridge since 2026-09-27.

Read `CLAUDE.md` before changing either. It carries the invariants and a long
list of things that looked fine locally and went wrong on the way to
production.

## How a request actually flows

```
renter picks 1-5 listings ("Request viewing")
      │
      ▼
request modal  ─────────►  viewing-request-create
  signed in                  screens listings against what is still live
  calendar, 2-day buffer      charges one viewing credit per listing
      │                       writes request + items + events, emails ops
      ▼
WhatsApp deep link  ──►  renter messages us, opening the 24-hour window
      │
      ▼
AI operator  ─────────►  proposes each step every 10 minutes; a person
      │                   approves, or it acts alone behind three locks
      ▼
Zalo bridge  ─────────►  sends to each agent from the business account,
      │                   forwards their replies back
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
| `supabase/functions/_shared/viewing-domain.ts` | Event types, derived states and the reducer. The single source for the viewing enums. |
| `supabase/functions/_shared/viewing/` | The viewing domain: intake, itinerary, reminders, substitutes, search, selection, the WhatsApp agent, the ops actions, and the AI operator (planner, proposals, autonomy). Pure TypeScript, unit tested against an in-memory database. |
| `supabase/functions/_shared/whatsapp/`, `_shared/realtor/` | The two transports and their sending rules: WhatsApp to renters, Zalo to agents. |
| `supabase/migrations/` | Schema. Read `CLAUDE.md` before adding one - there are two migration paths here that fight each other. |
| `bridge/` | The Zalo bridge daemon and its VPS deploy scripts. Its own `package.json`; runs on an always-on machine, not in Supabase. |
| `patches/` | `patch-package` patches applied on install. |
| `docs/` | `SPEC.md` (domain model), `PLAN-v3.md` (milestones and status), `whatsapp-go-live.md` (the Meta checklist), plus platform notes: `inbound-email.md`, `basemap.md`, `vibe-matching-v2.md`. |

## Running it

```sh
npm i
npm run dev        # renter SPA
npm run dev:ops    # operator console
npm test           # vitest unit tests (functions, SPA, bridge), no browser needed
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

Worth doing before any change to renter-facing copy - production is on the
real number, so a copy change reaches real renters on merge. `/dev/phone` is
the interactive version - a fake WhatsApp thread you can type into - and it
refuses to run once `WHATSAPP_MODE=cloud`, which is how production runs,
because an endpoint that fabricates inbound messages against a live number is a
forgery tool.

## Deploying

Merging to `main` is the deploy.

| Workflow | Fires on | Does |
|---|---|---|
| `ci.yml` | every pull request and push to `main` | Type-check the SPA, unit tests, build, and check the generated MCP function is in sync. |
| `deploy-functions.yml` | changes under `supabase/functions/**` or `config.toml` | `supabase functions deploy`. Never deletes, but fails while a deployed function has no source; a new function needs a `config.toml` entry. |
| `deploy-migrations.yml` | changes under `supabase/migrations/**` | `supabase db push`. Only *lists* on pull requests, so merge is the first real test of a migration. |
| `deploy-ops.yml` | changes under `ops/` or `supabase/functions/_shared/` | Builds the ops console and deploys it to Vercel (https://hausto-ops.vercel.app). |

The frontend publishes from Lovable (Share → Publish). The Zalo bridge is
deployed by hand to its VPS with `bridge/deploy/deploy.sh` - see
`bridge/README.md`. Edge-function secrets go
in the Supabase dashboard, never from a shell - `CLAUDE.md` records three
separate incidents of a pasted value arriving mangled, and an empty secret is a
valid secret as far as the CLI is concerned.

## Where it is up to

**WhatsApp is live.** Production has run `CloudApiAdapter` since 2026-09-18,
with all five templates approved and re-checked against Meta hourly. How it got
there, and how to read its failures, is `docs/whatsapp-go-live.md`. The
automated agent (`VIEWING_AGENT_ENABLED`) is off, so renter replies route to
an operator. Dev and every test still run on `MockAdapter`, and new work must
still be demoable on it: a change that cannot be demoed on the mock is wrongly
scoped.

**The AI operator acts alone.** SPEC §10 describes it in stages. In production
all five actions it may take alone are switched on with their measured gates
overridden, and `REALTOR_CHANNEL=bridge`, so messages to agents go out through
the Zalo bridge. **Pause** on the console's AI operator screen stops all of it.

**Supply is the constraint.** 180 active listings against an 800 gate, and 46%
with a dialable agent against a 60% bar. `docs/PLAN-v3.md` opens with the
numbers.

## Payments

Polar is the processor; PayPal is retired. A viewing request costs one credit
per listing, drawn from the Pass ledger or a windowed allowance - never both,
which is a mistake this codebase has already made once and now guards against
in SQL. See the Payments section of `CLAUDE.md` before touching any of it.

## Project links

- Lovable project: https://lovable.dev/projects/614aa0f7-490d-413a-8576-174e6d3df45e
- Supabase project ref: `gbgrwjdmytaksrztcyzs`
