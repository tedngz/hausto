

## Investigation: Duplicate Listings from Batdongsan

### Root Cause

Two issues cause duplicates:

**1. Cross-district search overlap.** Batdongsan search results for "Quận 1" and "Quận 3" return overlapping listings (promoted/featured results, or listings from other cities like Hanoi appearing in HCMC searches). The logs confirm the same titles ("Mini Apartment for Rent in Central Hanoi", "Lakeview City Service Apartment") were saved as NEW in both the Quận 1 crawl (09:31) and the Quận 3 crawl (09:34).

**2. No pre-scrape dedup against the database.** The system extracts listing URLs from the search page (Phase 1), then immediately spends Firecrawl credits scraping each detail page (Phase 2). It only checks for duplicates in `savePropertiesToDB` AFTER scraping and AI extraction are complete. But the duplicate check relies on `source_url` matching, and listing URLs extracted from different search pages may have subtle variations (trailing params, different path formats) that survive `normalizeSourceUrl`.

Additionally, the `externalId` is generated as `btoa(normalizedUrl).substring(0, 100)` -- base64 of the URL truncated to 100 chars. Two slightly different URLs could produce the same first 100 base64 chars, or conversely, the same URL with minor differences produces different IDs.

### Plan

**A. Pre-scrape dedup (saves Firecrawl credits AND prevents duplicates)**

In `scrape-marketplace`, after Phase 1 extracts listing URLs but BEFORE Phase 2 scrapes detail pages:
- Normalize all extracted listing URLs
- Batch-query `external_properties` to check which URLs already exist
- Skip detail-page scraping for URLs already in the DB (just update `last_verified_at`)
- Only spend Firecrawl credits on genuinely new listings

**B. Stronger URL normalization for batdongsan**

Extract the canonical listing ID from batdongsan URLs (the `-prNNNNN` suffix) and use that as the `external_id` instead of base64-encoding the full URL. This makes dedup immune to URL path variations.

For nhatot, extract the numeric ID from `/NNNNNN.htm`.

**C. Cross-city filtering**

After Phase 3 AI extraction, compare the extracted property location against the requested crawl location/city. Reject listings where the detected city doesn't match the target city (e.g., a Hanoi listing appearing in an HCMC district search).

### Files Changed

**`supabase/functions/scrape-marketplace/index.ts`**
- Add `extractListingId(url, marketplace)` helper that pulls `pr12345` from batdongsan URLs and numeric IDs from nhatot URLs
- After Phase 1 `extractListingUrls`, batch-check existing URLs in DB; split into `newUrls` (need scraping) and `existingUrls` (just refresh `last_verified_at`)
- Use extracted listing ID as `external_id` in `savePropertiesToDB` instead of `btoa(url)`
- Add city-match filter: compare `detectCity(property.location)` against `detectCity(crawlLocation)`, skip mismatches

