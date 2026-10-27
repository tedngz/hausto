# Ops console

The operator's surface. A separate app from the renter SPA, on purpose: a
different auth surface (an `ops` role, not a renter session), a different deploy
cadence, and a different standard - this one is meant to stay ugly and fast.

Run it with `npm run dev:ops`, build it with `npm run build:ops` (output:
`dist-ops/`). It never ships inside the renter bundle.

It is served at https://hausto-ops.vercel.app, Vercel project `hausto-ops` in
the `ted-team` scope. `.github/workflows/deploy-ops.yml` type-checks, builds
and uploads `dist-ops/` on every merge to main that touches `ops/` or
`supabase/functions/_shared/` (the console imports the reducer from there). It
needs a `VERCEL_TOKEN` repository secret and skips with a notice without one.

## Why it shares the root `package.json`

CLAUDE.md asks for a separate Vite app, and the separation that matters is the
one you can see: a separate entry, a separate config, a separate build output,
and no route into it from the renter SPA. What it does not have is a dependency
tree of its own, and that is deliberate - a second `package.json` needs a second
lockfile, and an unpinned one would make this the only part of the repo whose
builds are not reproducible. It uses the versions of React, Vite and
supabase-js the root already pins.

If the two ever need to diverge on a dependency version, that is the moment to
split it properly - not before.

## What it may read

Operators get SELECT and nothing else. Every state change goes through the
`ops-record-outcome` edge function, which is where SPEC §4 is enforced - and
which calls the same `performOpsAction` the AI operator does, so there is one
implementation of each action, whoever takes it. Beyond the viewing tables the
role reads `operator_proposals`, `ai_operator_controls` and
`zalo_bridge_status`; the `AI_OPERATOR_AUTONOMY` and `REALTOR_CHANNEL` secrets
it cannot read, so the planner writes what it concluded about them to
`ai_operator_controls.last_state` for the console to show.

Nothing here can read a renter's name or phone number: no RLS policy grants
`renters` or `messages` to the `ops` role (invariant 4). Requests are worked by
their `ref`. If a screen here ever appears to need a renter's number, the answer
is that ops should be messaging them through the system, not ringing them - which
is what the reply box on each request is for.

The renter's thread comes from `ops_request_thread()`, a function that returns
message bodies, times and the 24-hour window, and never the number or name. The
broker conversation is `realtor_messages`, readable directly: it holds what we
sent each broker and what they said back, and nothing about the renter.

## The screens

Three, switched by state rather than a router:

- **Queue** - open requests ranked by SLA, waiting renter replies first, with a
  count of pending AI operator proposals that never changes the ranking.
- **A request** - one card per listing: the agent's contact, the Vietnamese
  draft, the broker transcript, the paste-parse box (`ops-parse-reply`, which
  suggests an outcome and never records one), the seven outcomes, what the ad
  states about the lease and what the agent said (`LeaseTermsForm`, recorded
  as `LEASE_TERMS` and printed in the renter's plan), and any message queued
  for or failed on the Zalo bridge. Above them, the renter's
  thread and reply box, the itinerary builder, and the AI operator's proposals
  for this request, each with approve, reject, and - for one that will run
  alone - **Hold**.
- **AI operator** - agreement per action, paste-parse accuracy against the
  PLAN-v3 bar, the three locks per action (with **Pause** and **Restore the
  gate**), anything it did alone with **Flag as wrong**, and the bridge device
  (online, sent today, queued, last error, **Pause sending**).

What those mean, and the rules behind them, is SPEC §4 and §10.

## Status is derived, never stored

The queue and every card compute state by running the shared reducer
(`supabase/functions/_shared/viewing-domain.ts`) over the event log. There is no
status column anywhere in the viewing schema to read instead, and that is
invariant 1 rather than an oversight.
