# Plan: Add PowerShell migration scripts

The existing `.sh` scripts can't run in Windows PowerShell. I'll add `.ps1` equivalents alongside them so you can run the migration natively on Windows.

## Files to create

1. **`scripts/migrate-functions/set-new-project-secrets.ps1`**
   - Prompts (secure input) for each of the 6 secrets: `LOVABLE_DB_URL`, `LOVABLE_DB_SERVICE_ROLE_KEY`, `LOVABLE_DB_ANON_KEY`, `OPENAI_API_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
   - Empty input = skip that secret
   - Calls `supabase secrets set --project-ref <ref> NAME=VALUE` for each

2. **`scripts/migrate-functions/deploy.ps1`**
   - Deploys one or more functions with `--no-verify-jwt`
   - Same args as the bash version: `.\deploy.ps1 <project-ref> <function-name> [...]`

3. **Update `scripts/migrate-functions/README.md`**
   - Add a Windows/PowerShell section showing the `.ps1` commands

## Prerequisites you need on your machine

- **Supabase CLI**: your screenshot shows `supabasecd` (typo). Install with `scoop install supabase` (correct name) or `npm i -g supabase`. Verify with `supabase --version`.
- **The repo cloned locally** at e.g. `C:\Users\tedng\hausto\`. The scripts I created live in the Lovable sandbox — you need to pull the latest commits from GitHub first so `scripts/migrate-functions/` exists on disk.
- **You must `cd` into the repo** before running the scripts, e.g. `cd C:\Users\tedng\hausto\scripts\migrate-functions`.

## How you'll run it (after the plan is built)

```powershell
cd C:\Users\tedng\<your-repo>\scripts\migrate-functions
supabase login
.\set-new-project-secrets.ps1 joxxcvxbsjedzkfpmkfc
.\deploy.ps1 joxxcvxbsjedzkfpmkfc chat-ai
```

If PowerShell blocks script execution, run once per session:
`Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`

## Out of scope
- No changes to the bash scripts, edge functions, or frontend.
- No changes to `.env` — that's still a manual paste of the new project's URL + anon key once deploy succeeds.
