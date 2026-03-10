

## Plan: Integrate QStash into scheduled-crawl

### Prerequisites — 3 new secrets needed

The project doesn't have QStash secrets yet. We need:
- `QSTASH_TOKEN` — for publishing follow-up messages (self-chaining)
- `QSTASH_CURRENT_SIGNING_KEY` — for verifying incoming QStash requests
- `QSTASH_NEXT_SIGNING_KEY` — for key rotation verification

All three are found in the Upstash QStash console (same account as the existing Redis). I'll prompt you to add them before deploying.

### Changes to `supabase/functions/scheduled-crawl/index.ts`

**1. Add QStash signature verification (top of handler)**
- Read `upstash-signature` header
- If present, verify using HMAC-SHA256 against the signing keys (inline, no external library needed for Deno)
- If verification fails, return 401
- If no signature header, fall back to existing authorization (service role key in Authorization header or pg_cron calls)

**2. Self-chaining for `backfill-vibe` action**
- After processing a batch, if there are remaining properties and time is running out (>130s elapsed), publish a follow-up message to QStash targeting the same endpoint with `{ action: "backfill-vibe", continuation: true }`
- Uses `QSTASH_TOKEN` with QStash REST API (simple fetch, no library needed)
- Adds a 5-second delay to the follow-up to avoid hammering

**3. Self-chaining for regular crawl post-processing**
- After the main crawl completes, if there are still properties needing vibe backfill and time ran out, chain a `backfill-vibe` follow-up via QStash

**4. No changes to config.toml** — `verify_jwt: false` stays since we handle auth manually

### Implementation approach — no external libraries

Instead of importing `@upstash/qstash`, I'll use:
- **Verification**: Deno's built-in `crypto.subtle` for HMAC-SHA256 signature verification (the QStash signature is a JWT signed with the signing key)
- **Publishing**: Simple `fetch` POST to `https://qstash.upstash.io/v2/publish/` with the QStash token as Bearer auth

This avoids any esm.sh import issues in the Edge Function runtime.

### What stays the same
- All crawl logic, Redis tracking, scraping, vibe analysis unchanged
- pg_cron can remain as a backup trigger (it'll still work alongside QStash)
- Admin Tools manual triggers continue working
- The function remains callable from any authorized source

