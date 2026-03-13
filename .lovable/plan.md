

## Plan: Optimize Firecrawl Credit Usage

### Current Usage Analysis

Each crawl run costs approximately **11-20 Firecrawl credits**:
- 1 credit for the search results page
- Up to 10 credits for individual detail pages (`maxResults: 10`)

With **120 location-marketplace combos** (60 locations × 2 marketplaces), a `frequencyMinutes: 240` setting, and QStash triggering every 30 minutes, the system attempts ~120 crawls per rotation cycle (~60 hours). This projects to **~1

,500-2,400 credits per cycle**,olean exceeding the 3,000/month budget within days.

### Proposed    Changes (3 levers)

####imed 1. Reduce locations to high-value center districts only

Trim `CRAWL_LOCATIONS` from 60 to **20 districts** — the central/popular ones where renters actually search. Remove rural/suburban districts with low rental activity.

**Keep (20 districts):**
- **HCMC (10):** Quận 1, 3, 7, Bình Thạnh, Phú Nhuận, Tân Bình, Gò Vấp, Thủ Đức, Quận 4, Quận 10
- **Hanoi (7):** Ba Đình, Hoàn Kiếm, Đống Đa, Cầu Giấy, Hai Bà Trưng, Tây Hồ, Long Biên
- **Da Nang (3):** Hải Châu, Sơn Trà, Ngũ Hành Sơn

**Remove:** Cần Giờ, Củ Chi, Hóc Môn, Nhà Bè, Bình Chánh, all outer Hanoi districts (Sóc Sơn, Thanh Oai, Ứng Hòa, Mỹ Đức, Ba Vì, Phúc Thọ, etc.), Hoàng Sa, Hòa Vang

#### 2. Reduce max listings per run from 10 to 5

Change `maxListingsPerRun` default from 10 to 5, and cap the config UI max at 10 instead of 20. This cuts detail-page Firecrawl calls in half.

Each crawl: 1 (search) + 5 (details) = **6 credits per run**.

#### 3. Increase crawl frequency from 240min to 720min (12 hours)

Change `DEFAULT_CONFIG.frequencyMinutes` from 240 to 720. This means each location-marketplace combo is crawled at most twice per day.

### Projected Monthly Usage

```text
20 locations × 2 marketplaces = 40 combos
720min frequency → each combo crawled ~2×/day → 80 crawls/day
6 credits/crawl → 480 credits/day → ~14,400/month ← still too high

Adjust to 1440min (24h):
40 combos × 1 crawl/day = 40 crawls/day
6 credits/crawl = 240 credits/day → ~7,200/month ← still over

Need to also skip Firecrawl for search page:
Use directFetch for search page (free), Firecrawl only for details.
40 crawls/day × 5 credits = 200/day → ~6,000/month ← over

Further: maxResults = 3:
40 × 3 = 120 credits/day → 3,600/month ← close

Or: frequency 2880min (48h):
40 combos / 2 days = 20 crawls/day × 5 = 100/day → 3,000/month ✓
```

**Recommended combo for 3,000 credits/month:**
- 20 locations × 2 marketplaces = 40 combos
- Frequency: **2880 min (48 hours)**
- Max listings: **5 per run**
- Use **directFetch for search pages** (save 1 credit/run), Firecrawl only for detail pages
- Result: ~20 crawls/day × 5 credits = **~100 credits/day ≈ 3,000/month**

### Implementation Details

**File: `supabase/functions/scheduled-crawl/index.ts`**
- Trim `CRAWL_LOCATIONS` array from 60 to 20 center districts
- Change `DEFAULT_CONFIG.frequencyMinutes` from 240 to 2880
- Change `DEFAULT_CONFIG.maxListingsPerRun` from 10 to 5

**File: `supabase/functions/scrape-marketplace/index.ts`**
- In the main serve handler, use `directFetch` + `extractLinksFromHtml` for search result pages (Phase 1), falling back to `firecrawlFetch` only if directFetch returns 403
- Keep `firecrawlFetch` for Phase 2 (individual detail pages) where anti-bot protection is stricter
- This saves 1 Firecrawl credit per crawl run

