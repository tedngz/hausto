

## Plan: Replace Firecrawl with Direct HTTP Fetch + HTML Parsing

### Problem
The automated crawl system depends on Firecrawl API credits. When credits run out (402 error), no new listings are scraped. This is a recurring blocker.

### Approach
Replace all Firecrawl API calls in `scrape-marketplace/index.ts` with direct `fetch()` requests. The two Firecrawl touchpoints are:
1. **Search page scraping** (Phase 1, line 648) -- fetches search result pages from batdongsan/nhatot
2. **Detail page scraping** (Phase 2, `scrapeDetailPage` at line 283) -- fetches individual listing pages

### Changes

**`supabase/functions/scrape-marketplace/index.ts`**:

1. **New `directFetch()` helper** -- Makes HTTP GET requests with browser-like headers (User-Agent, Accept-Language) to avoid basic bot detection. Returns raw HTML.

2. **New `extractLinksFromHtml()` helper** -- Parses `<a href="...">` tags from raw HTML using regex to replace Firecrawl's `links` format output.

3. **New `htmlToBasicMarkdown()` helper** -- Strips HTML tags to produce plain text content (used as input to the existing OpenAI extraction prompts). Keeps text structure readable enough for GPT-4o-mini.

4. **Replace Phase 1 Firecrawl call** (lines 648-660) -- Use `directFetch(searchUrl)` instead of `fetch('https://api.firecrawl.dev/v1/scrape', ...)`. Parse HTML to extract links and text content.

5. **Replace `scrapeDetailPage` Firecrawl call** (lines 283-296) -- Use `directFetch(url)` instead. Extract images via existing `extractImagesFromHtml()` and text via `htmlToBasicMarkdown()`.

6. **Remove `FIRECRAWL_API_KEY` dependency** -- No longer imported or checked. The function works with zero external API costs (aside from OpenAI which is still needed for data extraction/translation).

### What stays the same
- All OpenAI-based extraction logic (Phase 3, fallback extraction)
- URL building logic for batdongsan/nhatot
- Image extraction from HTML (already regex-based)
- `scheduled-crawl/index.ts` -- no changes needed, it just calls `scrape-marketplace`
- Deduplication, filtering, caching logic

### Risk & Mitigation
- **Anti-bot blocking**: Batdongsan/Nhatot may block direct requests. Mitigated with realistic browser headers and reasonable request spacing. If blocked, the function gracefully returns empty results (same as current Firecrawl failure behavior).
- **No JavaScript rendering**: These sites are server-rendered, so static HTML fetch should capture listings. If dynamic content is missed, the AI fallback extraction from search pages provides a safety net.

### Deployment
Redeploy `scrape-marketplace` edge function. No database changes needed.

