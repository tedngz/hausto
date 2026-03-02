

## Plan: Prevent Duplicate Crawled Listings and Add Listing Count Control

### Problem Analysis

**Duplicates**: The current system has two dedup mechanisms, but both have gaps:
1. A 6-hour cache check skips re-crawling recent data, but after 6 hours the same listings get re-crawled
2. An upsert on `(source, external_id)` should prevent DB duplicates, but `external_id` is generated from `btoa(sourceUrl)` -- if the scraper returns a slightly different URL (query params, trailing slash), a duplicate row gets created

**Listing count**: Currently hardcoded to `MAX_DETAIL_PAGES = 10` in the scraper. The admin has no way to control how many listings get crawled per location/marketplace.

---

### Changes

#### 1. Stronger Dedup in the Crawl Function
- Before storing each property, query `external_properties` for existing rows matching the same `source` and `source_url` (exact match on cleaned URL)
- Normalize source URLs before comparison (strip trailing slashes, sort query params, remove tracking parameters)
- Add a `newListings` counter to the crawl results so the admin can see how many were genuinely new vs. updated

#### 2. Admin-Controlled Max Listings Per Location
- Add a `maxListingsPerLocation` parameter to `crawl-external-properties` (default: 10)
- Pass it through to `scrape-marketplace` as a new `maxResults` parameter
- `scrape-marketplace` will use this to override the hardcoded `MAX_DETAIL_PAGES`

#### 3. Admin Tools UI Updates
- Add a slider (or number input) for "Max listings per location" (range: 1-20, default: 10)
- Add a "New vs Updated" breakdown in the crawl results summary
- Display dedup stats (skipped duplicates count)

---

### Technical Details

**Files to modify:**

1. **`supabase/functions/crawl-external-properties/index.ts`**
   - Accept `maxListingsPerLocation` in `CrawlRequest`
   - Pass it to `scrape-marketplace` as `maxResults`
   - Add URL normalization helper: strip trailing `/`, remove UTM params, lowercase
   - Before upserting, check if a row with the same normalized `source_url` already exists -- if so, update instead of creating a new external_id
   - Track `newListings` vs `updatedListings` in `CrawlResult`

2. **`supabase/functions/scrape-marketplace/index.ts`**
   - Accept `maxResults` in `SearchParams` (defaults to current `MAX_DETAIL_PAGES = 10`)
   - Use it to cap `extractListingUrls` output and the fallback extraction
   - Adjust `PAGES_TO_SCRAPE` dynamically: if `maxResults <= 5`, only scrape 1-2 pages

3. **`src/pages/AdminTools.tsx`**
   - Add `crawlMaxListings` state (number, default 10)
   - Render a Slider component (1-20) with label showing current value
   - Pass `maxListingsPerLocation` in the function invoke body
   - Update results display to show new/updated/duplicate breakdown

