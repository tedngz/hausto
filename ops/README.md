# Ops console

The operator's surface. A separate app from the renter SPA, on purpose: a
different auth surface (an `ops` role, not a renter session), a different deploy
cadence, and a different standard - this one is meant to stay ugly and fast.

Run it with `npm run dev:ops`, build it with `npm run build:ops` (output:
`dist-ops/`). It never ships inside the renter bundle.

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
`ops-record-outcome` edge function, which is where SPEC §4 is enforced.

Nothing here can read a renter's name or phone number: no RLS policy grants
`renters` or `messages` to the `ops` role (invariant 4). Requests are worked by
their `ref`. If a screen here ever appears to need a renter's number, the answer
is that ops should be messaging them through the system, not ringing them.

## Status is derived, never stored

The queue and every card compute state by running the shared reducer
(`supabase/functions/_shared/viewing-domain.ts`) over the event log. There is no
status column anywhere in the viewing schema to read instead, and that is
invariant 1 rather than an oversight.
