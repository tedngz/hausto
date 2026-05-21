# Complex Explorer — v1 Plan

A new top-level route `/complexes` that delivers the "Complex-First" experience from the project knowledge: a curated directory of vetted luxury buildings, a rich detail view per complex, and a 3-step concierge lead form that captures qualified inquiries.

## 1. Database (new tables)

**`complexes`** — permanent building profiles (admin-editable, publicly readable)
- `name`, `slug` (unique), `city` (`ho_chi_minh` | `hanoi`), `district`
- `developer`, `management_company`, `year_completed`
- `hero_image`, `gallery` (text[])
- `tagline`, `description`
- `pet_policy` (text), `amenities` (text[])
- `average_rent_brackets` (jsonb, e.g. `{ "1br": {min, max}, "2br": {...}, "3br": {...} }`)
- `insider_pros` (text[]), `insider_cons` (text[])
- `commute_times` (jsonb, e.g. `{ "District 1": "15 min", "Airport": "25 min" }`)
- `tags` (text[]) for sticky chips ("Pet Friendly", "Savills Managed", "Thu Thiem")
- `latitude`, `longitude`
- `is_published` (bool, default true)

RLS: public SELECT where `is_published = true`; admin-only INSERT/UPDATE/DELETE via `has_role(auth.uid(), 'admin')`.

**`complex_inquiries`** — concierge leads
- `complex_id` (uuid, references complexes)
- `user_id` (uuid, nullable — supports anonymous pre-arrival leads)
- `full_name`, `email`, `phone` (nullable)
- `target_move_in_date` (date)
- `lease_duration_months` (int)
- `budget_usd_min`, `budget_usd_max` (int)
- `bedrooms_needed` (int)
- `has_pets` (bool)
- `additional_notes` (text)
- `status` (`new` | `contacted` | `closed`, default `new`)

RLS: anyone can INSERT (lead capture); only admins can SELECT/UPDATE.

A seed migration inserts ~6 starter complexes across HCMC (Thu Thiem, D1, D2) and Hanoi (Tay Ho, Ba Dinh) so the page isn't empty on first load.

## 2. Frontend

**Routing** — add `/complexes` and `/complexes/:slug` in `src/App.tsx`.

**`src/pages/Complexes.tsx`** — directory page
- Editorial hero: "Find Your Home in Vietnam Before You Land. 100% Vetted Luxury Complexes."
- Filter bar: City (HCMC / Hanoi), District (dynamic from data), Tag chips (Pet Friendly, Savills Managed, Furnished, etc.)
- Responsive card grid: hero image, name, district, management chip, rent-from price, sticky benefit tags
- Card click → detail page
- SEO via Helmet (title, description, canonical, OG)
- Semantic `<main>` + single `<h1>`

**`src/pages/ComplexDetail.tsx`**
- Hero image + gallery strip
- Title block with district, developer, management, year completed
- Tabs / stacked sections: Overview · Amenities · Insider Truths (pros/cons) · Price Index (table from `average_rent_brackets`) · Commute · Neighborhood
- Floating right-side CTA card (sticky on desktop, fixed bottom on mobile): "Check Active Availability for My Move-in Date" → opens concierge modal
- Pet policy callout, management/developer trust block
- SEO: per-complex title/description/OG

**`src/components/ConciergeCaptureModal.tsx`** — 3-step responsive modal
1. **Trip basics** — target move-in date, lease duration (6/12/24+ months)
2. **Home requirements** — bedrooms needed, budget range (USD slider), has pets toggle
3. **Contact** — full name, email, phone (optional), additional notes
- Progress indicator, back/next, validation per step
- Submits to `complex_inquiries` via Supabase client (anon insert allowed)
- Success state with confirmation copy and "We'll be in touch within 24h"

**Landing page integration** — add a primary CTA on `LandingPage.tsx` linking to `/complexes` ("Explore Vetted Complexes"). Keep existing Discover flow untouched.

**Sitemap** — add `/complexes` to `public/sitemap.xml`.

## 3. Out of scope (per project knowledge)
- No live scraping into this page
- No room-by-room marketplace
- No peer messaging
- No short-term rental support

## Technical details

```text
src/
├── App.tsx                                 (+ 2 routes)
├── pages/
│   ├── Complexes.tsx                       (new)
│   └── ComplexDetail.tsx                   (new)
├── components/
│   ├── ConciergeCaptureModal.tsx           (new)
│   ├── ComplexCard.tsx                     (new)
│   └── ComplexFilters.tsx                  (new)
├── hooks/
│   └── useComplexes.tsx                    (new — react-query wrappers)
└── components/LandingPage.tsx              (+ CTA link)

supabase/migrations/
└── <ts>_create_complexes_and_inquiries.sql
```

Data layer: react-query with `['complexes', filters]` and `['complex', slug]` keys. Anonymous insert path for `complex_inquiries` (no auth required to submit a lead — matches pre-arrival expat persona).

Design: editorial, premium tone — large hero typography, generous whitespace, muted neutrals + a single warm accent. Use existing semantic tokens in `index.css` / `tailwind.config.ts`; no hardcoded colors.

After approval I'll run the migration first, then build the pages and modal.