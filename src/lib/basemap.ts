/**
 * Single source of truth for the raster basemap behind every Leaflet map.
 *
 * Why this exists: the maps used to hardcode CARTO's Positron tiles
 * (`basemaps.cartocdn.com/light_all/...`). CARTO closed that CDN to anonymous
 * traffic - the requests still return 200s, so nothing errors, but every tile
 * comes back stamped "API KEY REQUIRED - carto.com/basemaps/apikey" across the
 * image. There is no code bug to fix: the provider wants a key.
 *
 * So the provider is configuration now, not a literal in a component:
 *  - Set one of the key env vars below and you get that provider's Positron /
 *    Positron-alike tiles, unstamped.
 *  - Set none and you get Esri's World Light Gray Canvas, which needs no key
 *    and keeps the pale, low-contrast look the overlays are drawn against.
 *
 * `VITE_MAP_BASEMAP` overrides the auto-pick when more than one key is present.
 */

/** A single Leaflet `tileLayer` in the stack, bottom-most first. */
export interface BasemapTileLayer {
  url: string;
  attribution: string;
  subdomains?: string;
  /** Highest zoom the map allows. */
  maxZoom: number;
  /** Highest zoom the provider actually ships; Leaflet upscales past it. */
  maxNativeZoom?: number;
}

export interface Basemap {
  /** Provider id, also the accepted value of `VITE_MAP_BASEMAP`. */
  id: BasemapId;
  /** Label + link, for the attribution line the provider's terms require. */
  attribution: string;
  layers: BasemapTileLayer[];
}

export type BasemapId = 'carto' | 'stadia' | 'maptiler' | 'esri' | 'osm';

/**
 * Vite inlines `import.meta.env.VITE_*` by static string replacement, so each
 * var has to be spelled out here - a computed lookup would come back undefined
 * in a production build.
 */
const readEnv = (value: string | undefined): string => (value ?? '').trim();

const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const ESRI_ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors';
const STADIA_ATTRIBUTION =
  '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const MAPTILER_ATTRIBUTION =
  '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/**
 * The keyless fallback. Esri's Light Gray Canvas splits basemap and labels
 * into two services, so the label layer sits on top of the base one; it only
 * ships to z16, hence `maxNativeZoom` (Leaflet stretches the z16 tiles rather
 * than showing blank squares when someone zooms to a single building).
 */
const esri = (labels: boolean): Basemap => ({
  id: 'esri',
  attribution: ESRI_ATTRIBUTION,
  layers: [
    {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      attribution: ESRI_ATTRIBUTION,
      maxZoom: 19,
      maxNativeZoom: 16,
    },
    ...(labels
      ? [
          {
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
            attribution: '',
            maxZoom: 19,
            maxNativeZoom: 16,
          },
        ]
      : []),
  ],
});

const osm = (): Basemap => ({
  id: 'osm',
  attribution: OSM_ATTRIBUTION,
  layers: [
    {
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: OSM_ATTRIBUTION,
      subdomains: 'abc',
      maxZoom: 19,
    },
  ],
});

const carto = (apiKey: string, labels: boolean): Basemap => ({
  id: 'carto',
  attribution: CARTO_ATTRIBUTION,
  layers: [
    {
      url: `https://{s}.basemaps.cartocdn.com/${labels ? 'light_all' : 'light_nolabels'}/{z}/{x}/{y}{r}.png?api_key=${encodeURIComponent(apiKey)}`,
      attribution: CARTO_ATTRIBUTION,
      subdomains: 'abcd',
      maxZoom: 20,
    },
  ],
});

const stadia = (apiKey: string): Basemap => ({
  id: 'stadia',
  attribution: STADIA_ATTRIBUTION,
  layers: [
    {
      url: `https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png?api_key=${encodeURIComponent(apiKey)}`,
      attribution: STADIA_ATTRIBUTION,
      maxZoom: 20,
    },
  ],
});

const maptiler = (apiKey: string): Basemap => ({
  id: 'maptiler',
  attribution: MAPTILER_ATTRIBUTION,
  layers: [
    {
      url: `https://api.maptiler.com/maps/positron/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(apiKey)}`,
      attribution: MAPTILER_ATTRIBUTION,
      maxZoom: 20,
    },
  ],
});

export interface BasemapOptions {
  /**
   * Keep the provider's own place labels. Maps that draw their own labels pass
   * `false`: the provider's names are Vietnamese ("Quan 12", "Huyen Hoc Mon")
   * and would double up with the English ones the overlay places.
   *
   * Only esri and carto can serve a label-free base - stadia's and maptiler's
   * raster tiles bake the labels into the image, so those providers keep
   * theirs regardless.
   */
  labels?: boolean;
}

/**
 * Resolve the basemap for this build.
 *
 * Explicit `VITE_MAP_BASEMAP` wins; a keyed provider named there without its
 * key falls through to the keyless default rather than rendering stamped or
 * 403ing tiles.
 */
export function getBasemap({ labels = true }: BasemapOptions = {}): Basemap {
  const cartoKey = readEnv(import.meta.env.VITE_CARTO_API_KEY);
  const stadiaKey = readEnv(import.meta.env.VITE_STADIA_API_KEY);
  const maptilerKey = readEnv(import.meta.env.VITE_MAPTILER_API_KEY);
  const requested = readEnv(import.meta.env.VITE_MAP_BASEMAP).toLowerCase() as BasemapId | '';

  switch (requested) {
    case 'carto':
      if (cartoKey) return carto(cartoKey, labels);
      break;
    case 'stadia':
      if (stadiaKey) return stadia(stadiaKey);
      break;
    case 'maptiler':
      if (maptilerKey) return maptiler(maptilerKey);
      break;
    case 'osm':
      return osm();
    case 'esri':
      return esri(labels);
  }

  if (cartoKey) return carto(cartoKey, labels);
  if (stadiaKey) return stadia(stadiaKey);
  if (maptilerKey) return maptiler(maptilerKey);
  return esri(labels);
}
