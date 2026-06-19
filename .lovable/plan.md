
# Migrate All Edge Functions to Your Own Supabase Project

Move every edge function in the project off Lovable-managed Supabase (which meters invocations against Lovable Cloud credits) and onto a Supabase project **you own directly**, so invocations are billed by Supabase (500K free/month) instead of Lovable.

## What you need to do first (manual, one-time)

I can't create a Supabase project on your behalf, so before any code changes:

1. Create a new Supabase project at https://supabase.com/dashboard (free tier is fine).
2. Note these from the new project's **Project Settings → API**:
   - Project URL (e.g. `https://abcd1234.supabase.co`)
   - Project ref (the `abcd1234` part)
   - `service_role` key (secret)
3. Install the Supabase CLI locally (`brew install supabase/tap/supabase` or equivalent) — needed once to deploy the 36 functions to the new project. I can generate a deploy script for you.
4. Decide: do you want the **database** to also move, or only the **edge functions**?
   - **Functions only (recommended):** DB stays on the current Lovable Cloud Supabase. The new Supabase project hosts only the 36 functions, which connect back to the Lovable Cloud DB using its service role key. Zero data migration. This is what the plan below assumes.
   - **Functions + DB:** Much bigger migration (dump/restore schema, data, RLS, storage buckets, auth users, cron jobs). Out of scope for this plan — ask separately if you want it.

## Architecture after migration

```text
Browser (frontend)
  │
  │  Supabase JS client points at LOVABLE Supabase for DB/auth/storage
  │  Direct fetch() to YOUR Supabase for edge functions
  ▼
LOVABLE Supabase            YOUR Supabase
  - Postgres / RLS             - 36 Edge Functions
  - Auth                          (connect back to Lovable
  - Storage buckets                Supabase via service role)
  - Realtime
```

Frontend keeps using `@/integrations/supabase/client` for everything except `functions.invoke()`, which is replaced by a thin wrapper that calls your new Supabase functions endpoint.

## Code changes

### 1. New env vars (frontend)
Add to `.env`:
- `VITE_FUNCTIONS_SUPABASE_URL` — your new project URL
- `VITE_FUNCTIONS_SUPABASE_ANON_KEY` — your new project anon key

### 2. New helper: `src/integrations/supabase/functions-client.ts`
Creates a second Supabase client pointed at your new project, used **only** for `functions.invoke()`. Forwards the current user's JWT from the main client so auth still works.

### 3. Replace all `supabase.functions.invoke(...)` call sites
Search-replace across the frontend (~30-40 call sites) to use the new functions client. Behavior identical from the user's perspective.

### 4. Edge function code — add cross-project DB access
Every function that reads/writes the DB currently does:
```ts
createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))
```
On your new Supabase project, those env vars point at the *new empty* project. We rename the references to two new secrets that point at the **Lovable** project:
- `LOVABLE_DB_URL`
- `LOVABLE_DB_SERVICE_ROLE_KEY`

For JWT verification (functions that check the caller's user), we add:
- `LOVABLE_JWKS_URL` (or copy the `SUPABASE_JWKS` secret value)

A shared helper `supabase/functions/_shared/db-client.ts` centralises this so we touch each function minimally.

### 5. Update cron / QStash schedules
`scheduled-crawl`, `expire-subscriptions`, `process-vibe-queue`, `verify-external-listings`, `mirror-status`, etc. are triggered by pg_cron or QStash pointing at the old functions URL. After deploy, you'll update those endpoints to the new project's functions URL (I'll list the exact URLs to swap).

### 6. Copy all 30 secrets to the new project
The new Supabase project has none of: `OPENAI_API_KEY`, `BROWSERLESS_API_KEY`, PayPal keys, Upstash Redis, QStash, Resend, BatDongSan / Nhatot creds, etc. I'll generate a `supabase secrets set` script you run once with the values.

### 7. CORS allowlist
New functions need CORS allowing your published domains: `https://hausto.com`, `https://hausto.lovable.app`, preview URLs.

## Functions being moved (36 total)

activate-paypal-subscription, analyze-vibe, backfill-external-images, backfill-image-highlights, batch-generate-embeddings, batch-geocode-properties, batch-reanalyze-properties, bulk-import-properties, cancel-paypal-subscription, chat-ai, check-paypal-subscription, crawl-external-properties, create-paypal-subscription, expire-subscriptions, extract-phone, generate-property-embedding, handle-paypal-webhooks, hausto-ai-assist, mirror-status, notify-fast-track-request, notify-premium-interest, proactive-ai-reply, process-vibe-queue, property-discovery-cache, public-property-search, reactivate-paypal-subscription, recrawl-external-listing, scheduled-crawl, scrape-marketplace, sitemap, usage-tracking-redis, vector-property-search, verify-embeddings, verify-external-listings, vibe-score-cache

## Tradeoffs & risks (please read)

- **Cold starts:** Your new Supabase project's functions cold-start independently (~200–500ms first hit). Lovable's shared infra may be warmer.
- **Two Supabase clients in the frontend** adds a small amount of complexity.
- **Cross-project DB calls** add ~20–50ms latency per function (negligible for AI calls that take seconds anyway).
- **PayPal webhook URL** must be updated in your PayPal dashboard to the new functions URL or webhooks will silently fail.
- **`sitemap` function** is a public GET — if it's referenced in `robots.txt` or search-console, update the URL.
- **`public-property-search` and AI Agent discovery API** (llms.txt, openapi.json) — external consumers using the old URL will 404 until they update. We can keep a thin proxy on the old project that forwards to the new one if you need a transition period.
- This is a **substantial migration** — realistically 1–2 build-mode messages of changes plus your manual steps (create project, install CLI, run deploy + secrets scripts, update PayPal/QStash/cron URLs).

## Phases for implementation

1. **Phase 1 (you, manual):** Create new Supabase project, share URL + service role key, install Supabase CLI.
2. **Phase 2 (me, build mode):** Add `_shared/db-client.ts`, refactor all 36 functions to use it, add functions-client to frontend, replace all `.functions.invoke()` call sites, generate `deploy.sh` and `set-secrets.sh` scripts.
3. **Phase 3 (you):** Run the two scripts; paste secret values when prompted; confirm functions respond.
4. **Phase 4 (me):** Flip the `VITE_FUNCTIONS_SUPABASE_*` env vars to the new project, verify chat-ai works end-to-end.
5. **Phase 5 (you):** Update PayPal webhook URL, QStash schedules, any pg_cron jobs (I'll give exact SQL).

## Confirm before I proceed

- Have you created the new Supabase project? If yes, please share the **Project URL** and **project ref** (the service role key goes into `add_secret`, not the chat).
- Confirm DB stays on Lovable Cloud — only functions move. Correct?
- Are you OK with the 30-minute manual work in Phases 1, 3, 5?

Once you confirm, switch to build mode and I'll execute Phase 2.
