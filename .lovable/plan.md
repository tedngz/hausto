## Plan: Custom Complexes Map (`/map`)

### Scope
A new dedicated route `/map` rendering a premium, editorial-style map of all vetted complexes. Visual direction = "Topographic minimalist" prototype (cream canvas, abstract river/topo SVG, teal dot pins, coral active pin, hover labels, glass mini-card with hero image + district + USD rent range).

### Tech approach
- **Custom canvas, not Leaflet/Google Maps.** Real lat/lng are projected onto a stylized SVG backdrop via a simple equirectangular projection bounded to the active city's bbox. This keeps the unique, non-Google look while still placing pins at real geographic positions.
- Two city tabs: **Saigon** / **Hanoi** (each with its own bbox).
- Pins clickable + hoverable; selected pin shows the floating mini-card with hero image, name, district, rent bracket (USD, reusing existing bracket logic from `ComplexDetail`).
- Clicking the card title navigates to `/complexes/:slug`.
- Zoom +/− controls do simple SVG transform scaling (no tile loading).
- Responsive: aspect ratio scales down, mini-card flips/clamps to stay inside the canvas on mobile.

### Files
1. **`src/pages/ComplexMap.tsx`** (new) — page shell, header, city toggle, legend, footer CTA back to `/complexes`. Uses `useComplexes()`.
2. **`src/components/ComplexMapCanvas.tsx`** (new) — pure presentational SVG/HTML canvas: topo background, projected pins, hover labels, active mini-card, zoom controls.
3. **`src/App.tsx`** — register `/map` route.
4. **`src/components/Navigation.tsx`** and/or `LandingPage.tsx` `Complexes.tsx` — add a discreet link "View on map" so the page is discoverable (no major nav surgery).

### Data
- Source: existing `complexes` table via `useComplexes()`. Filter to entries with `latitude`/`longitude` set. No DB changes.
- Bbox constants for HCMC and Hanoi defined in the canvas component.

### Out of scope
- Real tile maps, clustering, search/filter inside the map (city toggle only for v1), persisted view state.

### Visual fidelity
Match the selected prototype exactly: `#FAF9F6` page bg, `#F3F0E9` canvas, `#0D4F4A` teal, `#F28D63` coral, Playfair serif heading "The Luxury Map of *Saigon* / *Hanoi*", dashed topo circles, abstract river path, small uppercase legend row, pulse animation on active pin.
