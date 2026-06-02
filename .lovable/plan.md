## Goal
Give the Luxury Map (`ComplexMapCanvas`, used on `/map` and on the complex detail page) the same clean monochrome basemap and branded pin look as the property `MapViewModal`, while preserving every existing piece: district outlines, district quick-facts card, place labels, landmark pins + profile cards, complex pins + profile cards, city toggle, zoom controls, pinch/drag, focus-on-complex behavior.

## Approach
Replace only the basemap rendering layer. Keep all overlay React UI (popover cards, district cards, labels) and all data (LABELS, LANDMARKS, DISTRICT_SHAPES, DISTRICT_FACTS, complexes) exactly as is.

### What changes
1. **Drop the custom transform stage** (`translate/scale` on a `<div>` wrapping `/maps/{city}.svg`) and the manual pan/zoom/pinch/wheel handlers.
2. **Mount a Leaflet map** in the existing container (same `aspect-[4/5] sm:aspect-[16/10] lg:aspect-[21/9]`, same rounded shell, same `#F3F0E9` fallback bg).
   - Tile layer: CARTO Positron `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png` (subdomains `abcd`, OSM+CARTO attribution).
   - `zoomControl: false` then `L.control.zoom({ position: 'bottomright' })`.
   - `scrollWheelZoom: true` (keep desktop wheel zoom), `touchZoom: true`, `dragging: true` — Leaflet handles all pan/pinch.
3. **City bounds + focus**:
   - When `city` changes: `map.fitBounds([[minLat,minLng],[maxLat,maxLng]], { padding: [20,20] })` using existing `BBOX`.
   - When `focusComplexId` provided: `map.setView([lat,lng], 16)`.
4. **District polygons → Leaflet**:
   - For each shape in `DISTRICT_SHAPES[city]`, render `L.polygon(rings)` with stroke `#F28D63` (dashed when inactive, solid+thicker when active) and a very light fill (`#F28D63` @ 0.06 inactive, 0.14 active).
   - `click` → toggle `activeDistrict`. Keep diagonal-hatch feel via SVG `fillPattern` is overkill on Leaflet; use a clean translucent fill instead — cleaner and matches the new sleeker look.
5. **Place labels (districts + water)**:
   - Render each as a Leaflet `divIcon` marker (non-interactive) with the existing typography classes. Positioning automatically follows pan/zoom.
6. **Landmark pins**:
   - `divIcon` with the orange diamond mark + tiny label below.
   - On click, set `activeId = 'lm-${name}'` — pop the existing profile card in a Leaflet `popup` (custom-classed for the same white/95 backdrop, shadow, image, blurb, "Learn more" link).
7. **Complex pins**:
   - `divIcon`: small `#0D4F4A` dot in white ring; active state = larger pulsing `#F28D63` dot (reuse the `haustoPulse` keyframes from `MapViewModal`).
   - On click, open a Leaflet `popup` rendered via React portal containing the existing card (hero image, name → `Link to /complexes/:slug`, PREMIUM tag, price bracket, tags, "View profile" CTA).
8. **District quick-facts card**:
   - Render as a Leaflet popup anchored at the polygon centroid (use existing `centroidOfRings`), styled identically to today's card.
9. **City switcher + any header chrome**: untouched — they live above the canvas.
10. **Cleanup**: remove `zoom`, `pan`, `pinchRef`, `dragRef`, `wasDraggedRef`, wheel-listener `useEffect`, the `transform`-applied stage div, the static `/maps/{city}.svg` `<img>`, the radial-dot texture overlay, the SVG `<polygon>`/`<defs>` block, and the manual `clampPct`/zoom-scale logic for labels and pins. Keep helpers actually still needed (`project` no longer needed; `centroidOfRings`, `BBOX`, `LABELS`, `LANDMARKS`, `DISTRICT_SHAPES`, `DISTRICT_FACTS`, `formatBracket` all stay).

### Visual result
Soft grey/white CARTO streets underneath, dashed orange district outlines with a subtle wash, identical labels/landmark/complex pins and cards — same editorial feel, but legible real streets, real river, snappier interaction.

## Out of scope
- No changes to `/maps/*.svg` assets (just unused after this — can stay).
- No data changes: same complexes, landmarks, districts, facts.
- No changes to header copy, city tabs, or page wrappers (`ComplexMap.tsx`, `ComplexDetail.tsx`).
- No new dependencies (Leaflet + CSS already used by `MapViewModal`).

## Technical notes
- Component still owns `city`, `activeId`, `activeDistrict` React state; Leaflet is treated as a render target managed in a `useEffect` keyed on `city` and on `complexes` length, with a separate effect to update active styles without rebuilding markers.
- For React-rich popups (landmark/complex/district cards), render the JSX into a detached DOM node via `createRoot` and pass that node to `L.popup().setContent(node)` — same pattern many Leaflet-React integrations use, avoids pulling in `react-leaflet`.
- Keep `popupAnchor` tuned so cards don't cover the pin.
- Mobile: Leaflet's built-in `tap` + pinch replaces the custom pointer logic — fewer bugs, better feel.
