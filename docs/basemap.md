# Map basemap tiles

## What broke

The Saigon/Hanoi map rendered every tile stamped with a diagonal
**"API KEY REQUIRED — carto.com/basemaps/apikey"** watermark.

Nothing in the app was broken. `ComplexMapCanvas` hardcoded CARTO's Positron
raster tiles:

```
https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png
```

CARTO closed that CDN to anonymous traffic. Unauthenticated requests are not
rejected — they still return `200` with a real PNG — so there is no console
error, no failed request, and no broken-tile placeholder to notice. CARTO just
renders the notice into the image itself. That is why it looked like an app bug
rather than a billing one.

## How it works now

`src/lib/basemap.ts` is the single source of truth. Both Leaflet maps
(`ComplexMapCanvas` and `MapLocationPicker`) ask it for the tile layers to
stack, so there is one place to change providers.

With no configuration it serves **Esri World Light Gray Canvas** — keyless,
and pale enough that the district borders, complex pins and landmark diamonds
drawn on top still read. Esri splits basemap and labels across two services, so
this provider returns two layers. It only ships tiles to z16, so the layers set
`maxNativeZoom: 16` with `maxZoom: 19`; Leaflet upscales past z16 instead of
showing blank squares.

## Getting the Positron look back

Positron is the pale cartography the overlays were designed against. Three
providers serve it or an equivalent; set the matching key in `.env` and the app
picks it up on the next build:

| Provider | Env var | Where to get a key | Style |
| --- | --- | --- | --- |
| CARTO | `VITE_CARTO_API_KEY` | carto.com/basemaps/apikey | `light_all` — the original |
| Stadia Maps | `VITE_STADIA_API_KEY` | client.stadiamaps.com | `alidade_smooth` — a Positron build |
| MapTiler | `VITE_MAPTILER_API_KEY` | cloud.maptiler.com | `positron` raster |

If more than one key is set, the order above decides. `VITE_MAP_BASEMAP`
overrides that — accepted values are `carto`, `stadia`, `maptiler`, `esri` and
`osm`. Naming a keyed provider without its key falls back to `esri` rather than
rendering stamped or `403`ing tiles.

These are `VITE_`-prefixed, so they are **inlined into the client bundle and
publicly readable**. Every provider above expects that for browser basemaps —
restrict the key by HTTP referrer in the provider's dashboard rather than
treating it as a secret.

## Attribution

Every provider here requires visible credit. `ComplexMapCanvas` hides Leaflet's
own attribution control to keep the canvas clean, so the credit line is rendered
under the legend from `basemap.attribution`. If you add a provider, add its
attribution string with it.
