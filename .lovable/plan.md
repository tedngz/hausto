## QStash Integration — Completed

The `scheduled-crawl` Edge Function now supports **Upstash QStash** for triggering and self-chaining:

### What was added
1. **QStash signature verification** — validates `upstash-signature` JWT header using HMAC-SHA256 with `QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY` (native `crypto.subtle`, no external deps)
2. **Self-chaining for `backfill-vibe`** — when the backfill loop hits the 130s time limit with remaining work, it publishes a continuation message to itself via QStash REST API with a 5s delay
3. **Post-crawl self-chaining** — after regular crawl runs, if vibe backfill was cut short or skipped entirely, it chains a `backfill-vibe` follow-up via QStash (10s delay)
4. **Fallback auth** — existing pg_cron / service role key / anon key auth still works alongside QStash

### Secrets added
- `QSTASH_TOKEN` — for publishing follow-up messages
- `QSTASH_CURRENT_SIGNING_KEY` — for verifying incoming requests
- `QSTASH_NEXT_SIGNING_KEY` — for key rotation

### Next step (manual)
Create a QStash schedule in the Upstash console:
- **Destination**: `https://gbgrwjdmytaksrztcyzs.supabase.co/functions/v1/scheduled-crawl`
- **Cron**: `*/30 * * * *`
- **Body**: `{"source": "qstash"}`
- **Content-Type**: `application/json`

Once confirmed working, the `auto-crawl-v2` pg_cron job can be removed.

## Firecrawl Credit Optimization — Completed

### Changes Made
1. **Trimmed locations from 60 to 20** — center districts only (HCMC: 10, Hanoi: 7, Da Nang: 3)
2. **Default frequency: 2880min (48h)** — each combo crawled every 2 days
3. **Default maxListingsPerRun: 5** — down from 10
4. **directFetch for search pages** — saves 1 Firecrawl credit per crawl by using plain HTTP for Phase 1, falling back to Firecrawl only if blocked
5. **Admin UI limits updated** — frequency slider max: 4320min (3 days), max listings slider max: 10

### Projected Usage
- 20 locations × 2 marketplaces = 40 combos
- 48h frequency → ~20 crawls/day × 5 credits = **~100 credits/day ≈ 3,000/month** ✓
