// One-off script: fetch OSM ways via Overpass and emit a minimalist SVG per city.
// Run: node scripts/generate-city-maps.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const CITIES = {
  ho_chi_minh: { s: 10.68, w: 106.62, n: 10.85, e: 106.83 },
  hanoi:       { s: 20.97, w: 105.74, n: 21.10, e: 105.93 },
};

const VIEW_W = 1000;
const VIEW_H = 700;

const QUERY = (bbox) => `[out:json][timeout:90][bbox:${bbox.s},${bbox.w},${bbox.n},${bbox.e}];
(
  way["waterway"~"river|canal"];
  way["natural"="water"];
  way["highway"~"^(motorway|trunk|primary)$"];
  way["leisure"~"park|golf_course"];
  way["landuse"~"grass|recreation_ground|forest|cemetery"];
);
out geom;`;

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
];

async function fetchOverpass(query) {
  let lastErr;
  for (const url of ENDPOINTS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          body: 'data=' + encodeURIComponent(query),
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
            'User-Agent': 'hausto-map-generator/1.0 (contact: dev@hausto.com)',
          },
        });
        if (res.status === 429 || res.status === 504) {
          console.warn(`  ${url} -> ${res.status}, retrying in ${(attempt+1)*5}s`);
          await new Promise(r => setTimeout(r, (attempt+1) * 5000));
          continue;
        }
        if (!res.ok) throw new Error(`${url} -> ${res.status}`);
        return await res.json();
      } catch (e) {
        console.warn('  Overpass failed:', e.message);
        lastErr = e;
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }
  throw lastErr;
}

function classify(tags = {}) {
  if (tags.waterway || tags.natural === 'water') return 'water';
  if (tags.highway) return 'roads';
  if (tags.leisure === 'park' || tags.leisure === 'golf_course' ||
      ['grass','recreation_ground','forest','cemetery'].includes(tags.landuse)) return 'parks';
  return null;
}

function project(bbox, lat, lon) {
  const x = ((lon - bbox.w) / (bbox.e - bbox.w)) * VIEW_W;
  const y = (1 - (lat - bbox.s) / (bbox.n - bbox.s)) * VIEW_H;
  return [x, y];
}

function buildPath(geom, bbox) {
  const pts = geom.map(({ lat, lon }) => project(bbox, lat, lon));
  // round to 0 decimals + dedupe consecutive
  const rounded = pts.map(([x, y]) => [Math.round(x), Math.round(y)]);
  const dedup = rounded.filter((p, i) => i === 0 || p[0] !== rounded[i-1][0] || p[1] !== rounded[i-1][1]);
  if (dedup.length < 2) return null;
  const closed = dedup.length > 3 &&
    dedup[0][0] === dedup[dedup.length-1][0] &&
    dedup[0][1] === dedup[dedup.length-1][1];
  // bounding box for area estimation
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of dedup) { if (x<minX) minX=x; if (x>maxX) maxX=x; if (y<minY) minY=y; if (y>maxY) maxY=y; }
  const bboxArea = (maxX - minX) * (maxY - minY);
  const d = 'M' + dedup.map(([x,y]) => `${x},${y}`).join('L') + (closed ? 'Z' : '');
  return { d, closed, bboxArea, span: Math.max(maxX-minX, maxY-minY) };
}

async function generate(cityKey) {
  const bbox = CITIES[cityKey];
  console.log(`\n→ ${cityKey}`);
  const data = await fetchOverpass(QUERY(bbox));
  const layers = { parks: [], water: [], roads: [] };
  let totalIn = 0;

  for (const el of data.elements) {
    if (el.type !== 'way' || !el.geometry) continue;
    totalIn++;
    const layer = classify(el.tags);
    if (!layer) continue;
    const path = buildPath(el.geometry, bbox);
    if (!path) continue;
    layers[layer].push(path);
  }

  console.log(`  ways in: ${totalIn}`);
  for (const k of Object.keys(layers)) console.log(`  ${k}: ${layers[k].length}`);

  // Cull tiny / noisy paths
  layers.parks = layers.parks.filter(p => p.closed && p.bboxArea >= 40);
  layers.water = layers.water.filter(p => p.span >= 6);
  layers.roads = layers.roads.filter(p => p.span >= 20);
  for (const k of Object.keys(layers)) console.log(`  ${k} after cull: ${layers[k].length}`);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" preserveAspectRatio="xMidYMid slice">
  <g class="parks" fill="#9CB89A" fill-opacity="0.18" stroke="none">
    ${layers.parks.filter(p => p.closed).map(p => `<path d="${p.d}"/>`).join('\n    ')}
  </g>
  <g class="water" fill="#0D4F4A" fill-opacity="0.12" stroke="#0D4F4A" stroke-opacity="0.25" stroke-width="0.6" stroke-linejoin="round" stroke-linecap="round">
    ${layers.water.map(p => p.closed ? `<path d="${p.d}" fill-rule="evenodd"/>` : `<path d="${p.d}" fill="none" stroke-width="1.8"/>`).join('\n    ')}
  </g>
  <g class="roads" fill="none" stroke="#0D4F4A" stroke-opacity="0.18" stroke-width="0.6" stroke-linejoin="round" stroke-linecap="round">
    ${layers.roads.map(p => `<path d="${p.d}"/>`).join('\n    ')}
  </g>
</svg>`;

  const out = `public/maps/${cityKey}.svg`;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, svg);
  const kb = (svg.length / 1024).toFixed(1);
  console.log(`  wrote ${out} (${kb} KB)`);
}

for (const k of Object.keys(CITIES)) {
  await generate(k);
}
