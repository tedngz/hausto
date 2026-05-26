## Plan: Real city shapes for `/map`

### Approach
Pre-bake one SVG per city from OpenStreetMap data, served as static assets. The existing `ComplexMapCanvas` keeps its pin/card layer; only the background swaps from abstract paths to the real city geometry. Pins still project from real lat/lng onto the same bbox the SVG was generated for, so they land in their correct neighborhoods.

### One-time generation script
`scripts/generate-city-maps.mjs` (run by me, not at runtime):
1. Query Overpass API for each city's bbox:
   - **HCMC bbox**: 10.68–10.85 lat, 106.62–106.83 lng
   - **Hanoi bbox**: 20.97–21.10 lat, 105.74–105.93 lng
2. Pull four layers per city:
   - District boundaries (`admin_level=8`, `boundary=administrative`)
   - Waterways (`natural=water`, `waterway=river|canal`)
   - Major roads (`highway=motorway|trunk|primary`)
   - Parks/green (`leisure=park`, `landuse=grass|recreation_ground`, `leisure=golf_course`)
3. Convert with `osmtogeojson`, simplify with `@turf/simplify` (tolerance ~0.0003), project to a 1000×700 viewBox using equirectangular projection bound to the bbox.
4. Emit `public/maps/ho_chi_minh.svg` and `public/maps/hanoi.svg`, each with grouped `<g>` layers (`parks`, `water`, `roads`, `districts`) using `currentColor` + opacity classes so brand colors come from CSS.

Expected size ~80–200 KB per city after simplification.

### Runtime changes (`ComplexMapCanvas.tsx`)
- Remove abstract `<path>`/`<circle>` background.
- Add `<img src="/maps/{city}.svg" />` (or inline-fetch + dangerouslySetInnerHTML if we want to retheme strokes via CSS) absolutely positioned to fill the canvas, with `preserveAspectRatio="xMidYMid slice"`.
- Keep the radial dot grid overlay for texture.
- Same bbox constants drive both the SVG projection (at generation time) and the pin projection (at runtime), so they stay aligned.
- Optional: small "© OpenStreetMap" attribution in the legend (OSM license requirement).

### Styling
Within each SVG, layer strokes/fills use semantic CSS variables so they tint with the theme:
- Districts: `#0D4F4A` stroke at 12% opacity, no fill
- Water: `#0D4F4A` fill at 10% opacity
- Roads: `#0D4F4A` stroke at 8% opacity, 0.5px
- Parks: `#9CB89A`-ish muted sage fill at 18% opacity

### Out of scope
- District labels (can add later if desired)
- Live OSM fetching at runtime (static is faster + works offline)
- Tile-based maps

### Files touched
- New: `scripts/generate-city-maps.mjs`, `public/maps/ho_chi_minh.svg`, `public/maps/hanoi.svg`
- Edit: `src/components/ComplexMapCanvas.tsx` (swap background + add attribution)
- Edit: `package.json` (devDeps: `osmtogeojson`, `@turf/simplify`; one-off run, not in build pipeline)
