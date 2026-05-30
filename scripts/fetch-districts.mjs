// Fetch real admin_level=8 district polygons from Nominatim and write them
// as simplified lat/lng polygons for the in-app map overlay.
// Run: node scripts/fetch-districts.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

const TARGETS = {
  ho_chi_minh: [
    { label: 'District 1', q: 'Quận 1, Ho Chi Minh City, Vietnam' },
    { label: 'District 3', q: 'Quận 3, Ho Chi Minh City, Vietnam' },
    { label: 'District 4', q: 'Quận 4, Ho Chi Minh City, Vietnam' },
    { label: 'District 5', q: 'Quận 5, Ho Chi Minh City, Vietnam' },
    { label: 'District 7', q: 'Quận 7, Ho Chi Minh City, Vietnam' },
    { label: 'District 10', q: 'Quận 10, Ho Chi Minh City, Vietnam' },
    { label: 'District 11', q: 'Quận 11, Ho Chi Minh City, Vietnam' },
    { label: 'Thu Duc', q: 'Thành phố Thủ Đức, Ho Chi Minh City, Vietnam' },
    { label: 'Binh Thanh', q: 'Quận Bình Thạnh, Ho Chi Minh City, Vietnam' },
    { label: 'Phu Nhuan', q: 'Quận Phú Nhuận, Ho Chi Minh City, Vietnam' },
    { label: 'Tan Binh', q: 'Quận Tân Bình, Ho Chi Minh City, Vietnam' },
    { label: 'Tan Phu', q: 'Quận Tân Phú, Ho Chi Minh City, Vietnam' },
    { label: 'Go Vap', q: 'Quận Gò Vấp, Ho Chi Minh City, Vietnam' },
    { label: 'Binh Tan', q: 'Quận Bình Tân, Ho Chi Minh City, Vietnam' },
    { label: 'District 6', q: 'Quận 6, Ho Chi Minh City, Vietnam' },
    { label: 'District 8', q: 'Quận 8, Ho Chi Minh City, Vietnam' },
    { label: 'District 12', q: 'Quận 12, Ho Chi Minh City, Vietnam' },
  ],
  hanoi: [
    { label: 'Hoan Kiem', q: 'Quận Hoàn Kiếm, Hanoi, Vietnam' },
    { label: 'Ba Dinh', q: 'Quận Ba Đình, Hanoi, Vietnam' },
    { label: 'Tay Ho', q: 'Quận Tây Hồ, Hanoi, Vietnam' },
    { label: 'Dong Da', q: 'Quận Đống Đa, Hanoi, Vietnam' },
    { label: 'Hai Ba Trung', q: 'Quận Hai Bà Trưng, Hanoi, Vietnam' },
    { label: 'Cau Giay', q: 'Quận Cầu Giấy, Hanoi, Vietnam' },
    { label: 'Thanh Xuan', q: 'Quận Thanh Xuân, Hanoi, Vietnam' },
    { label: 'Long Bien', q: 'Quận Long Biên, Hanoi, Vietnam' },
    { label: 'Hoang Mai', q: 'Quận Hoàng Mai, Hanoi, Vietnam' },
  ],
};

async function nominatim(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&polygon_geojson=1&limit=1&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'hausto-map-generator/1.0 (dev@hausto.com)' } });
  if (!res.ok) throw new Error(`${q} -> ${res.status}`);
  return (await res.json())[0];
}

// Ramer–Douglas–Peucker on lat/lng (cheap; coords are small range so ok)
function rdp(points, eps) {
  if (points.length < 3) return points;
  const sqDist = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    if (dx === 0 && dy === 0) return (p[0]-a[0])**2 + (p[1]-a[1])**2;
    const t = ((p[0]-a[0])*dx + (p[1]-a[1])*dy) / (dx*dx + dy*dy);
    const tc = Math.max(0, Math.min(1, t));
    const px = a[0] + tc*dx, py = a[1] + tc*dy;
    return (p[0]-px)**2 + (p[1]-py)**2;
  };
  let maxD = 0, idx = 0;
  for (let i=1;i<points.length-1;i++){const d=sqDist(points[i],points[0],points[points.length-1]); if(d>maxD){maxD=d;idx=i;}}
  if (maxD > eps*eps) {
    const a = rdp(points.slice(0, idx+1), eps);
    const b = rdp(points.slice(idx), eps);
    return a.slice(0,-1).concat(b);
  }
  return [points[0], points[points.length-1]];
}

function extractPolygons(geo) {
  // returns array of rings as [[lat,lng], ...]
  const out = [];
  const eps = 0.0008; // ~80m simplification
  const push = (ring) => {
    const pts = ring.map(([lng, lat]) => [lat, lng]);
    const simp = rdp(pts, eps);
    if (simp.length >= 4) out.push(simp);
  };
  if (geo.type === 'Polygon') push(geo.coordinates[0]);
  else if (geo.type === 'MultiPolygon') for (const poly of geo.coordinates) push(poly[0]);
  return out;
}

const result = {};
for (const [city, list] of Object.entries(TARGETS)) {
  result[city] = [];
  for (const t of list) {
    try {
      const r = await nominatim(t.q);
      if (!r?.geojson) { console.warn('no geojson:', t.label); continue; }
      const rings = extractPolygons(r.geojson);
      if (!rings.length) { console.warn('empty rings:', t.label); continue; }
      result[city].push({ name: t.label, rings });
      console.log(`  ${city} · ${t.label}: ${rings.length} ring(s), ${rings[0].length} pts`);
      await new Promise(r => setTimeout(r, 1100)); // be nice to Nominatim
    } catch (e) {
      console.warn('  fail', t.label, e.message);
    }
  }
}

mkdirSync('src/data', { recursive: true });
writeFileSync('src/data/cityDistricts.json', JSON.stringify(result));
console.log('wrote src/data/cityDistricts.json');
