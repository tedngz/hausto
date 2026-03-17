## Agent-Friendly AI Bot Integration — Completed

### What Was Built
1. **`public-property-search` Edge Function** — Public read-only API for AI agents (GET, no auth, rate-limited 60/min, paginated, city/district/budget/rooms/style filters, returns both internal + external listings with USD conversion)
2. **`sitemap` Edge Function** — Dynamic XML sitemap of all active property pages
3. **`public/llms.txt`** — AI-readable site manifest describing Hausto and its API
4. **`public/openapi.json`** — OpenAPI 3.0 spec for the public search API
5. **`public/robots.txt`** — Updated with GPTBot, ClaudeBot, PerplexityBot, ChatGPT-User + sitemap link
6. **JSON-LD structured data** — Schema.org `RealEstateListing` on property detail pages via react-helmet-async
7. **Base JSON-LD** — Schema.org `WebSite` with `SearchAction` in index.html

### API Endpoint
```
GET https://gbgrwjdmytaksrztcyzs.supabase.co/functions/v1/public-property-search?city=hcmc&min_budget=300&max_budget=800&style=modern&limit=5
```

---

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

## Duplicate Listing Prevention — Completed

### Root Cause
1. Cross-district search overlap (promoted/featured listings from other cities)
2. No pre-scrape dedup — Firecrawl credits spent on listings already in DB

### Changes Made (`scrape-marketplace`)

**A. Canonical Listing ID Extraction**
- `extractListingId(url, marketplace)` extracts stable IDs:
  - Batdongsan: `-pr12345678` → `pr12345678`
  - Nhatot: `/123456.htm` → `nt123456`
  - Airbnb: `/rooms/12345` → `ab12345`
- Used as `external_id` in DB instead of fragile `btoa(url)` truncation

**B. Pre-scrape Database Dedup**
- After Phase 1 URL extraction, batch-queries `external_properties` by `external_id` and `source_url`
- Existing listings: only refresh `last_verified_at` + `expires_at` (zero Firecrawl credits)
- New listings only: proceed to Phase 2 detail-page scraping

**C. Cross-city Filtering**
- After Phase 3 AI extraction, compares `detectCity(property.location)` vs `detectCity(crawlLocation)`
- Rejects listings where detected city doesn't match target (e.g., Hanoi listing in HCMC search)

### Impact
- Saves ~2-3 Firecrawl credits per crawl run (skipping known listings)
- Eliminates duplicate entries from cross-district overlap
- Prevents cross-city contamination from promoted listings
