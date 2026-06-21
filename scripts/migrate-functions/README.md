# Edge Function Migration: Lovable Cloud → Self-Owned Supabase

Goal: stop paying Lovable Cloud credits for Edge Function invocations by moving
compute to the user's own Supabase project. The Postgres database, auth,
storage, and the frontend Supabase client continue to live on the
Lovable-managed project (`gbgrwjdmytaksrztcyzs`).

| Component                  | Host                                  |
| -------------------------- | ------------------------------------- |
| Postgres / Auth / Storage  | `gbgrwjdmytaksrztcyzs` (Lovable)      |
| Edge Functions (compute)   | `joxxcvxbsjedzkfpmkfc` (self-owned)   |
| Frontend DB client         | Lovable project (unchanged)           |
| Frontend Functions client  | Self-owned project (new)              |

## Phase 2a: chat-ai proof of concept

### 1. Set runtime secrets on the new project

Run this once. It uses the Supabase CLI you already have installed.

**macOS / Linux / Git Bash / WSL:**

```bash
cd scripts/migrate-functions
./set-new-project-secrets.sh joxxcvxbsjedzkfpmkfc
```

**Windows PowerShell:**

```powershell
cd scripts\migrate-functions
# Once per session if execution policy blocks scripts:
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\set-new-project-secrets.ps1 joxxcvxbsjedzkfpmkfc
```

The script will prompt you for each secret value. You need to have ready:

- `LOVABLE_DB_URL`              = `https://gbgrwjdmytaksrztcyzs.supabase.co`
- `LOVABLE_DB_SERVICE_ROLE_KEY` = Lovable project's service role key (Supabase dashboard → Settings → API)
- `LOVABLE_DB_ANON_KEY`         = Lovable project's anon/publishable key
- `OPENAI_API_KEY`              = your existing OpenAI key
- `UPSTASH_REDIS_REST_URL`      = your existing Upstash URL
- `UPSTASH_REDIS_REST_TOKEN`    = your existing Upstash token

(These are the same values currently set on Lovable Cloud as runtime secrets.)

### 2. Deploy chat-ai to the new project

**macOS / Linux / Git Bash / WSL:**

```bash
./deploy.sh joxxcvxbsjedzkfpmkfc chat-ai
```

**Windows PowerShell:**

```powershell
.\deploy.ps1 joxxcvxbsjedzkfpmkfc chat-ai
```

The function deploys with `--no-verify-jwt` because the function does its own
JWT verification against the Lovable auth (see code in `chat-ai/index.ts`).


### 3. Point the frontend at the new project for chat-ai

Add to `.env` (alongside the existing `VITE_SUPABASE_*` lines):

```
VITE_FUNCTIONS_SUPABASE_URL="https://joxxcvxbsjedzkfpmkfc.supabase.co"
VITE_FUNCTIONS_SUPABASE_ANON_KEY="<paste anon key from new project Settings → API>"
```

The Vite dev server / next build will pick these up. Without them the app
silently falls back to the Lovable Cloud invocation (= 402 again).

### 4. Verify

Open the app, send a chat message via the AI assistant. Watch logs on the
**new** project:

```bash
supabase functions logs chat-ai --project-ref joxxcvxbsjedzkfpmkfc --tail
```

You should see the request landing, the JWT being verified against the Lovable
project, and an OpenAI call going out. If chat works end-to-end, the pattern
is validated and Phase 2b (bulk migration of the remaining 35 functions) can
proceed using the same shared `_shared/db-client.ts` helper.

## Phase 2b (later)

Repeat steps 1–2 for the remaining functions. Each function only needs the
secrets it actually uses. Cron schedules, PayPal webhook URLs, and QStash
schedules need to be re-pointed in a separate phase — none of those affect
chat-ai, so the POC can be validated without touching them.
