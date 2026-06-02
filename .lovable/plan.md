## Goal
Make the property location map (the small modal map shown from a property card) feel premium and editorial — less "Google Maps", more Hausto.

## Scope
Only `src/components/MapViewModal.tsx`. No logic changes — same modal, same data, same lat/lng marker.

## Changes

1. **Swap tile layer to a minimal monochrome basemap**
   - Replace the default colorful OpenStreetMap tiles with CARTO Positron (free, no key, OSM-attributed): `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png`.
   - Result: soft grey/white streets, muted labels, no clashing reds/greens — matches Hausto's editorial palette.
   - Keep proper attribution (© OpenStreetMap, © CARTO) per their terms.

2. **Custom marker instead of default blue pin**
   - Drop the Leaflet default icon (and its CDN icon URLs). Use `L.divIcon` with a small branded pin: a primary-colored dot with a soft ring/pulse, rendered via inline HTML + tailwind-ish inline styles using the project's primary color (`#0D4F4A`).
   - Cleaner silhouette, no shadow PNG.

3. **Refined map chrome**
   - Hide the default zoom control (`zoomControl: false`) or restyle to bottom-right, smaller.
   - Disable scroll-wheel zoom on initial load to feel calmer; keep drag + double-click zoom.
   - Add subtle inner border-radius + ring via wrapper (`rounded-b-lg overflow-hidden ring-1 ring-border/40`).
   - Slightly taller (380px) for better composition.

4. **Tighter dialog header**
   - Keep title + location description, but reduce vertical padding so the map dominates.

## Out of scope
- No changes to the larger `ComplexMapCanvas` (already styled).
- No new dependencies — Leaflet + CARTO tiles only.
- No marker clustering or extra POIs.

## Technical notes
- CARTO Positron is free for commercial use with attribution; no API key.
- `divIcon` HTML: a 14px primary dot inside a 32px translucent ring, centered via `iconAnchor: [16,16]`.
- Attribution string: `© <a href="https://www.openstreetmap.org/copyright">OSM</a> · <a href="https://carto.com/attributions">CARTO</a>`.
