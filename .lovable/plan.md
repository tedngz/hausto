## Goal
Add a curated list of well-known HCMC apartment projects and a new admin tool that crawls external listings filtered to those projects, with an optional max-price cap (default 10M VND/month).

## Updated HCMC apartment projects catalog
Grouped by district (expanded with the user's suggestions and other commonly-searched projects):

- **D1 / D4 (Central)**: Vinhomes Golden River (Ba Son), Saigon Royal, The Tresor, The Marq, Sunwah Pearl, Millennium, Icon 56, RiverGate Residence, Charmington La Pointe
- **D2 / Thu Duc (East)**:
  - Thao Dien / An Phu: Masteri Thao Dien, Masteri An Phu, Gateway Thao Dien, Estella Heights, The Estella, The Vista, Thao Dien Pearl, Q2 Thao Dien, Lumiere Riverside, D'Edge Thao Dien, Nassim Thao Dien
  - Thu Thiem / An Khanh: Empire City, The River Thu Thiem, Sala (Sarimi / Sarina / Sadora), **New City Thu Thiem**, Diamond Island (Đảo Kim Cương)
  - Cat Lai / An Phu south: The Sun Avenue, The Krista, The CBD Premium Home
  - Thu Duc north: Vinhomes Grand Park (S-series + Origami + Glory), Lavita Charm, Lavita Garden, Centana Thu Thiem
- **D7 (Phu My Hung South)**: Sky Garden 1/2/3, Riverside Residence, Happy Valley, Midtown (Sakura / The Peak / The Signature), Scenic Valley, The Panorama, Saigon South Residences (SSR), The Ascentia, Urban Hill, Hung Phuc (Happy Residence), Riviera Point, Eco Green Saigon
- **Binh Thanh**: Vinhomes Central Park (Landmark 81 / Park / Central towers), Saigon Pearl (Ruby/Sapphire/Topaz), City Garden, The Manor, Pearl Plaza, Sunwah Pearl
- **Phu Nhuan / Tan Binh**: The Botanica, Garden Gate, Newton Residence, Orchard Parkview, Orchard Garden, Kingston Residence, Republic Plaza, Cộng Hòa Garden
- **Tan Phu**: **Celadon City** (Ruby / Emerald / Sapphire / Diamond Alnata), Carillon, Richstar, Jamila
- **D10 / D11**: Hado Centrosa Garden, Rivera Park, Res 11, The Everrich Infinity (D5)
- **Go Vap / D12**: The Botanica (Pho Quang), Orchid Park, Sunview Town, Dream Home Riverside

These are stored as a typed list in the codebase so we can extend later. Each entry: `{ name, district, city, aliases? }` — aliases support Vietnamese variants ("Đảo Kim Cương" vs "Diamond Island", "Thủ Thiêm New City" vs "New City") so the marketplace keyword search hits both.

## What we'll build

### 1. Project catalog (data file)
New file `src/data/hcmcApartmentProjects.ts` exporting the grouped list above (typed). Also re-exported as a flat array for the admin UI.

### 2. Backend: extend `crawl-external-properties`
Currently it loops over `locations[]` with a fixed `query: 'căn hộ chung cư cho thuê'`. We extend it to also accept:
- `projects?: { name: string; district?: string; aliases?: string[] }[]` — when provided, the function loops over projects instead of generic locations and sends each project name as the `query` to `scrape-marketplace` (and the project's district as `location`, so URLs still resolve cleanly on Batdongsan/Nhatot).
- `maxPriceVnd?: number` — passed straight through to `scrape-marketplace` as `maxPrice` (already supported in its body schema).

Behavior:
- For Batdongsan: when a district slug exists, the URL becomes `/cho-thue-can-ho-chung-cu-{district}-tp-hcm?keyword={projectName}` (small change in `buildSearchUrl` to also append `keyword=` when a district is present).
- For Nhatot: existing fallback already supports `?q=`, so we pass the project name as the query.
- After scraping, do a server-side post-filter: keep only properties whose `title + description + location` contains the project name OR any alias (case + diacritic insensitive). This avoids polluting the DB with unrelated listings the marketplace search returned.
- Apply price filter post-scrape too (`price <= maxPriceVnd`) as a safety net for sites that ignore the URL price param.
- Store properties as today (existing flow), so vibe analysis, dedup, and cache invalidation all work unchanged.

### 3. Admin UI: new "Project-Targeted Crawl" card
Added to `src/pages/AdminTools.tsx`, near the existing crawl card. It contains:
- Multi-select list of projects grouped by district (checkboxes with "Select all in D2", etc.).
- A search/filter input to quickly find a project by name.
- Marketplace toggles (Batdongsan + Nhatot; Airbnb hidden — wrong inventory type).
- Max price input/slider, default **10,000,000 VND/month**, range 3M–50M.
- "Max listings per project" slider (default 10).
- "Run vibe analysis" toggle (reuse existing logic).
- "Start project crawl" button → calls `crawl-external-properties` with the new `projects` + `maxPriceVnd` payload, iterating like today (one project per call, server returns `remainingProjects`).
- Progress card mirrors the existing one but shows "Project X of Y · {projectName}".
- Result card mirrors existing summary.

### 4. Small wiring tweaks
- `crawl-external-properties` returns `summary.remainingProjects` (analogous to `remainingLocations`) so the admin UI's `do { ... } while` loop drains the queue.
- Reuse the existing `property-discovery-cache` invalidation hook on completion (no change needed, just runs after the loop).

## Out of scope
- No DB schema changes — all new data fits existing `external_properties` columns.
- No change to scheduled crawler — this is a manual admin-only tool. (We can wire it into the schedule later if it proves useful.)
- No new edge function — extending `crawl-external-properties` keeps auth, dedup, vibe, and cache behavior consistent.
- Not touching public-property-search or chat-ai.

## Files to change
- `src/data/hcmcApartmentProjects.ts` — NEW
- `src/pages/AdminTools.tsx` — add "Project-Targeted Crawl" card + handler
- `supabase/functions/crawl-external-properties/index.ts` — accept `projects[]` + `maxPriceVnd`, loop over projects, post-filter by name/alias and price, return `remainingProjects`
- `supabase/functions/scrape-marketplace/index.ts` — minor: append `?keyword=` to Batdongsan URL even when a district slug is present (so project-name targeting works)

## Expected impact
- Admin can run a focused crawl like "Vinhomes Central Park + Masteri Thao Dien + Celadon City under 10M" in one click.
- DB fills with on-brand inventory matching popular searches users actually type, improving discovery + AI search results.
- Price ceiling keeps the catalog aligned with the budget tier most renters look at.
