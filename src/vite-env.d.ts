/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Force a basemap provider: carto | stadia | maptiler | esri | osm. */
  readonly VITE_MAP_BASEMAP?: string;
  /** carto.com/basemaps/apikey - without it CARTO stamps every tile. */
  readonly VITE_CARTO_API_KEY?: string;
  /** client.stadiamaps.com - alidade_smooth is the Positron look. */
  readonly VITE_STADIA_API_KEY?: string;
  /** cloud.maptiler.com - positron raster style. */
  readonly VITE_MAPTILER_API_KEY?: string;
}
