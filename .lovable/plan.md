
## Goal

Replace the 6 hand-seeded complexes with the full HCMC catalog (`src/data/hcmcApartmentProjects.ts`, ~60 buildings) and, on each Complex Detail page, add a new section that surfaces real listings (internal + external) from our database that belong to that building.

---

## Part 1 — Populate `complexes` from the HCMC catalog

### 1a. Schema additions
Add two columns to `complexes`:
- `aliases text[]` (default `'{}'`) — Vietnamese/English variants used for listing matching.
- `district_code text` — raw district label from the catalog (e.g. `D1`, `Thu Duc`, `Binh Thanh`) used for matching against `properties.location` strings. The existing `district` column stays as the human-readable label.

(Optional v2: a `complex_id` FK on `properties` / `external_properties` for exact matching. Out of scope for now — we'll use text matching.)

### 1b. Seed migration
Insert one row per entry in `HCMC_APARTMENT_PROJECTS`:
- `name` — from catalog
- `slug` — kebab-case of name (+ district suffix if collision, e.g. `jamila-thu-duc`)
- `city` — from catalog (`ho_chi_minh`)
- `district` — pretty label (`District 1`, `Thủ Đức`, `Bình Thạnh`, etc.)
- `district_code` — raw catalog value (`D1`, `Thu Duc`...)
- `aliases` — catalog `aliases` array, plus the name itself
- `tags` — derived (e.g. `['Riverside']` for projects whose name contains "River", `['Luxury']` for Vinhomes/Masteri/Estella tier, `['Pet Friendly']` left empty for now)
- `is_published` — `true`
- `hero_image`, `description`, `developer`, `management_company`, `year_completed`, `amenities`, `average_rent_brackets`, `insider_pros/cons`, `pet_policy` — **left null/empty for v1**. The existing 6 curated complexes already have rich content; the new ~60 will start as "stub" profiles and can be enriched over time via the admin tools.

The Complex Detail page already conditionally renders every section, so stub complexes will gracefully show only title + district + listings section.

### 1c. Keep the 6 existing curated complexes
Use `INSERT ... ON CONFLICT (slug) DO NOTHING` so we don't overwrite the 6 already-seeded buildings (Empire City, Masteri Thao Dien, etc.).

---

## Part 2 — "Listings at this complex" section on Complex Detail

### 2a. New hook: `useComplexListings(complex)`
Returns merged internal + external listings where the property belongs to this complex. Matching logic:

1. Build a list of search terms = `[complex.name, ...complex.aliases]`.
2. Query `properties` where `is_active = true` AND `is_property_within_active_period(last_activated_at)` AND `(title ILIKE %term% OR location ILIKE %term% OR description ILIKE %term%)` for any term.
3. Query `external_properties` where `is_active = true` AND `expires_at > now()` AND `(title ILIKE %term% OR location ILIKE %term%)`.
4. Merge, dedupe, sort by recency, cap at ~12.

Implementation note: Supabase supports `.or('title.ilike.%x%,location.ilike.%x%,title.ilike.%y%,...')`. We'll build that string from the aliases.

### 2b. UI section in `ComplexDetail.tsx`
New section placed between "Commute" and "Pet policy":
- Heading: "Live listings at {complex.name}" with a small count badge.
- 2-column responsive grid of compact `PropertyCard` (reuse the existing component) — same styling as Discover.
- Empty state: "No live listings at {name} right now — request availability and we'll alert vetted partner brokers." with the existing concierge CTA inline.
- Loading skeletons while fetching.

This naturally complements the sticky "Check active availability" CTA — the section says "here's what's listed today", the CTA says "and here's what's coming".

---

## Part 3 — Sitemap update

Regenerate `public/sitemap.xml` entries for all new `/complexes/:slug` URLs so they're indexable.

---

## Files touched

- `supabase/migrations/...` — add columns + seed inserts (single migration)
- `src/hooks/useComplexes.tsx` — extend `Complex` interface; add `useComplexListings(complex)`
- `src/pages/ComplexDetail.tsx` — render new "Live listings" section
- `public/sitemap.xml` — append new slugs

## Assumptions (flag if wrong)

1. **Stub profiles are acceptable** for the ~60 new complexes — we ship them now with just name/district and enrich content later. (Alternative: skip publishing them until a human writes copy.)
2. **Text matching is good enough** for v1 — names like "Masteri Thao Dien" or "Vinhomes Central Park" are distinctive enough in property `title`/`location` to avoid false positives. We can add a manual `complex_id` FK in v2 if matching gets noisy.
3. The existing 6 curated complexes keep their rich hand-written content untouched.
