import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Complex } from '@/hooks/useComplexes';
import cityDistrictsData from '@/data/cityDistricts.json';

type City = 'ho_chi_minh' | 'hanoi';

const BBOX: Record<City, { minLat: number; maxLat: number; minLng: number; maxLng: number }> = {
  ho_chi_minh: { minLat: 10.68, maxLat: 10.90, minLng: 106.60, maxLng: 106.88 },
  hanoi:       { minLat: 20.97, maxLat: 21.10, minLng: 105.74, maxLng: 105.93 },
};

const CITY_LABEL: Record<City, string> = {
  ho_chi_minh: 'Saigon',
  hanoi: 'Hanoi',
};

type Label = { name: string; lat: number; lng: number; kind: 'district' | 'water' };

const LABELS: Record<City, Label[]> = {
  ho_chi_minh: [
    { name: 'District 1', lat: 10.7757, lng: 106.7004, kind: 'district' },
    { name: 'District 3', lat: 10.7847, lng: 106.6840, kind: 'district' },
    { name: 'District 4', lat: 10.7578, lng: 106.7050, kind: 'district' },
    { name: 'District 5', lat: 10.7540, lng: 106.6680, kind: 'district' },
    { name: 'District 7 · PMH', lat: 10.7340, lng: 106.7220, kind: 'district' },
    { name: 'Thao Dien', lat: 10.8050, lng: 106.7390, kind: 'district' },
    { name: 'Thu Thiem', lat: 10.7770, lng: 106.7280, kind: 'district' },
    { name: 'Grand Park', lat: 10.8415, lng: 106.8370, kind: 'district' },
    { name: 'Thu Duc City', lat: 10.8520, lng: 106.7720, kind: 'district' },
    { name: 'Tan Phu', lat: 10.7920, lng: 106.6280, kind: 'district' },
    { name: 'Binh Thanh', lat: 10.8030, lng: 106.7070, kind: 'district' },
    { name: 'Phu Nhuan', lat: 10.7960, lng: 106.6790, kind: 'district' },
    { name: 'Saigon River', lat: 10.7920, lng: 106.7470, kind: 'water' },
  ],
  hanoi: [
    { name: 'Hoan Kiem', lat: 21.0277, lng: 105.8520, kind: 'district' },
    { name: 'Ba Dinh', lat: 21.0341, lng: 105.8240, kind: 'district' },
    { name: 'Tay Ho', lat: 21.0680, lng: 105.8200, kind: 'district' },
    { name: 'Dong Da', lat: 21.0125, lng: 105.8290, kind: 'district' },
    { name: 'Hai Ba Trung', lat: 21.0050, lng: 105.8570, kind: 'district' },
    { name: 'Cau Giay', lat: 21.0310, lng: 105.7990, kind: 'district' },
    { name: 'West Lake', lat: 21.0610, lng: 105.8180, kind: 'water' },
    { name: 'Hoan Kiem Lake', lat: 21.0290, lng: 105.8525, kind: 'water' },
    { name: 'Red River', lat: 21.0400, lng: 105.8870, kind: 'water' },
  ],
};

type Landmark = { name: string; lat: number; lng: number; blurb: string; image: string; url?: string };

const wm = (file: string) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=600`;

const LANDMARKS: Record<City, Landmark[]> = {
  ho_chi_minh: [
    { name: 'Ben Thanh Market', lat: 10.7725, lng: 106.6980,
      blurb: 'The 1914 colonial-era market — Saigon\'s most iconic landmark, ringed by hawkers, street food and the new Metro Line 1 terminus.',
      image: wm('Ben Thanh market 2.jpg'),
      url: 'https://en.wikipedia.org/wiki/B%E1%BA%BFn_Th%C3%A0nh_Market' },
    { name: 'Notre-Dame Cathedral', lat: 10.7798, lng: 106.6990,
      blurb: 'Twin red-brick spires built by French settlers in the 1880s. Anchors the postcard view of central District 1.',
      image: wm('Saigon Notre-Dame Basilica.jpg'),
      url: 'https://en.wikipedia.org/wiki/Saigon_Notre-Dame_Basilica' },
    { name: 'Bitexco Financial Tower', lat: 10.7717, lng: 106.7044,
      blurb: '262 m lotus-bud silhouette with a helipad sky deck. The original symbol of modern Saigon\'s skyline.',
      image: wm('Bitexco Financial Tower, Ho Chi Minh City, Vietnam.jpg'),
      url: 'https://en.wikipedia.org/wiki/Bitexco_Financial_Tower' },
    { name: 'Landmark 81', lat: 10.7951, lng: 106.7218,
      blurb: 'Vietnam\'s tallest building (461 m). Sits inside Vinhomes Central Park with riverside parks, mall and SkyView observation deck.',
      image: wm('Landmark 81 (32099609868).jpg'),
      url: 'https://en.wikipedia.org/wiki/Landmark_81' },
    { name: 'Tan Son Nhat Airport', lat: 10.8188, lng: 106.6519,
      blurb: 'Vietnam\'s busiest international gateway — 20–35 minutes from most central districts.',
      image: wm('Tan Son Nhat International Airport.jpg'),
      url: 'https://en.wikipedia.org/wiki/Tan_Son_Nhat_International_Airport' },
    { name: 'Crescent Lake', lat: 10.7295, lng: 106.7178,
      blurb: 'Phu My Hung\'s entertainment heart — lakeside promenade, Starlight Bridge, international cafés and weekend night markets.',
      image: wm('Phu My Hung, HCM City 1.jpg') },
    { name: 'Saigon Zoo & Botanical Garden', lat: 10.7878, lng: 106.7058,
      blurb: '160-year-old gardens at the edge of District 1 — one of the oldest zoos in the world and a green lung for the centre.',
      image: wm('Saigon zoo and botanical gardens, HCMC, Vietnam (23800870310).jpg') },
    { name: 'Vinhomes Grand Park', lat: 10.8415, lng: 106.8410,
      blurb: 'Vingroup\'s 271-hectare master-planned city in eastern Thu Duc — central park, international schools, malls and tens of thousands of new apartments.',
      image: wm('Công viên Ánh Sáng Vinhomes Grand Park, thủ đức, thành phố hồ chí minh.jpg'),
      url: 'https://en.wikipedia.org/wiki/Vinhomes_Grand_Park' },
    { name: 'Suoi Tien Theme Park', lat: 10.8635, lng: 106.8030,
      blurb: 'Vietnam\'s most beloved Buddhist-themed amusement park and the eastern terminus of Metro Line 1.',
      image: wm('Around Suoi Tien Park main entrance.jpg'),
      url: 'https://en.wikipedia.org/wiki/Su%E1%BB%91i_Ti%C3%AAn' },
    { name: 'VNU Ho Chi Minh City', lat: 10.8700, lng: 106.7990,
      blurb: 'Vietnam National University\'s sprawling 643-hectare Thu Duc campus — the country\'s largest higher-education hub.',
      image: wm('Nhà điều hành Đại học Quốc Gia TPHCM.jpg'),
      url: 'https://en.wikipedia.org/wiki/Vietnam_National_University,_Ho_Chi_Minh_City' },
  ],
  hanoi: [
    { name: 'Old Quarter', lat: 21.0345, lng: 105.8500,
      blurb: '36 ancient guild streets — Hanoi\'s 1,000-year-old commercial soul of street pho, beer corners and lantern-lit alleys.',
      image: wm('Hanoi Night Market 1.jpg'),
      url: 'https://en.wikipedia.org/wiki/Old_Quarter,_Hanoi' },
    { name: 'Hanoi Opera House', lat: 21.0245, lng: 105.8579,
      blurb: 'Belle Époque opera built 1911 — the architectural flagship of French Hanoi, hosting symphonic and ballet seasons.',
      image: wm('Hanoi Opera House 2018.jpg'),
      url: 'https://en.wikipedia.org/wiki/Hanoi_Opera_House' },
    { name: 'Lotte Center Hanoi', lat: 21.0314, lng: 105.8120,
      blurb: '272 m mixed-use tower with sky observatory, department store and one of the city\'s top hotel breakfasts.',
      image: wm('Lotte Center Hanoi.jpg'),
      url: 'https://en.wikipedia.org/wiki/Lotte_Center_Hanoi' },
    { name: 'Temple of Literature', lat: 21.0227, lng: 105.8355,
      blurb: 'Vietnam\'s first national university (1070 AD). Five walled courtyards of pavilions, lotus ponds and stone stelae.',
      image: wm('Hanoi Temple of Literature.jpg'),
      url: 'https://en.wikipedia.org/wiki/Temple_of_Literature,_Hanoi' },
  ],
};

type DistrictFact = {
  population: string;
  vibe: string;
  bestAreas: string[];
  blurb: string;
};

const DISTRICT_FACTS: Record<string, DistrictFact> = {
  'District 1':    { population: '~142,000', vibe: 'Central, cosmopolitan, walkable', bestAreas: ['Le Thanh Ton', 'Dong Khoi', 'Nguyen Hue'], blurb: 'Saigon\'s historic & financial core. Embassies, five-stars, the Japanese & Korean quarters, and the new Metro Line 1 terminus.' },
  'District 3':    { population: '~190,000', vibe: 'Leafy, French-colonial, café culture', bestAreas: ['Turtle Lake', 'Vo Thi Sau', 'Tu Xuong'], blurb: 'Old villas, boutique cafés and the rom-com Saigon expats fall for. Quiet but a 5-minute Grab from D1.' },
  'District 4':    { population: '~175,000', vibe: 'Compact, foodie, riverside', bestAreas: ['Hoang Dieu', 'Khanh Hoi'], blurb: 'Vietnam\'s densest district. Stellar street-seafood corridor and rising luxury riverside high-rises.' },
  'District 5':    { population: '~160,000', vibe: 'Chinatown energy, traditional', bestAreas: ['Cholon', 'Tran Hung Dao'], blurb: 'Saigon\'s historic Chinatown — pagodas, herbal-medicine markets and some of the best Cantonese in Vietnam.' },
  'District 7':    { population: '~365,000', vibe: 'Master-planned, family-first, expat hub', bestAreas: ['Phu My Hung', 'Crescent Lake', 'Sky Garden'], blurb: 'The original expat enclave — international schools, wide boulevards, Korean & Japanese supermarkets and lakeside running paths.' },
  'District 10':   { population: '~240,000', vibe: 'Local middle-class, sports & shopping', bestAreas: ['3/2 Boulevard', 'Su Van Hanh'], blurb: 'Vietnamese family neighbourhoods, Van Hanh Mall, big hospitals, indoor sports centres.' },
  'District 11':   { population: '~210,000', vibe: 'Working-class, street-food rich', bestAreas: ['Dam Sen', 'Lac Long Quan'], blurb: 'Home to Dam Sen water park and one of Saigon\'s densest hawker scenes.' },
  'Binh Thanh':    { population: '~500,000', vibe: 'Hyper-growth, riverside towers', bestAreas: ['Vinhomes Central Park', 'Landmark 81', 'Thao Dien-side'], blurb: 'Anchored by Landmark 81 & Vinhomes Central Park. The fastest-rising luxury riverside corridor in Saigon.' },
  'Phu Nhuan':     { population: '~165,000', vibe: 'Mid-luxe local, leafy lanes', bestAreas: ['Phan Xich Long', 'Truong Sa canal'], blurb: 'Phan Xich Long food street, canal-side runs and quietly stylish boutiques. A locals-meet-creatives sweet spot.' },
  'Tan Binh':      { population: '~470,000', vibe: 'Airport-adjacent, convenient', bestAreas: ['Bay Hien', 'Hoang Hoa Tham'], blurb: 'Wraps around Tan Son Nhat airport. Strong Vietnamese-Chinese community and Vietnam\'s biggest Catholic enclave.' },
  'Tan Phu':       { population: '~485,000', vibe: 'Suburban, family-focused', bestAreas: ['Aeon Tan Phu', 'Tay Thanh'], blurb: 'Mid-rise Vietnamese suburbia anchored by AEON Mall — comfortable, calm, and well-served.' },
  'Go Vap':        { population: '~680,000', vibe: 'Young, residential, affordable', bestAreas: ['Quang Trung', 'Pham Van Dong'], blurb: 'Big student & young-family district — affordable rents and a fast-growing café scene along Pham Van Dong.' },
  'Binh Tan':      { population: '~785,000', vibe: 'Industrial, sprawling, value', bestAreas: ['Aeon Binh Tan', 'Ten Lua'], blurb: 'The western gateway — factories, Aeon Mall and an emerging Korean community.' },
  'District 6':    { population: '~250,000', vibe: 'Old Chinatown, market-driven', bestAreas: ['Binh Tay Market', 'Phu Lam'], blurb: 'Home of Binh Tay wholesale market — the original heart of Cholon trading.' },
  'District 8':    { population: '~430,000', vibe: 'Canal-laced, in-transition', bestAreas: ['Pham The Hien', 'Chanh Hung'], blurb: 'A grid of canals and lively local markets, with affordable rents and rapid new-build activity.' },
  'District 12':   { population: '~620,000', vibe: 'Outer-ring, riverside green', bestAreas: ['An Phu Dong', 'Thanh Loc'], blurb: 'Saigon\'s northern edge along the river — quiet villa lanes, low-rise master plans and weekend cafés.' },
  'Thu Duc':       { population: '~1,200,000', vibe: 'Saigon\'s new eastern city — expat enclaves & master plans', bestAreas: ['Thao Dien', 'Thu Thiem', 'An Phu', 'Vinhomes Grand Park'], blurb: 'A merged "city-within-a-city" formed in 2021 from Districts 2, 9 & old Thu Duc. Home to Thao Dien\'s expat heart, Thu Thiem\'s new financial CBD, Metro Line 1 and Vietnam\'s biggest master-planned developments.' },

  'Hoan Kiem':     { population: '~135,000', vibe: 'Historic core, lake & Old Quarter', bestAreas: ['Old Quarter', 'French Quarter', 'Trang Tien'], blurb: 'The thousand-year heart of Hanoi: Hoan Kiem Lake, the 36 guild streets and the colonial Opera House quarter.' },
  'Ba Dinh':       { population: '~225,000', vibe: 'Government, embassy, boulevards', bestAreas: ['Truc Bach', 'Ngoc Ha', 'Giang Vo'], blurb: 'Embassies, the Presidential Palace and West-Lake-fringe villas. Quiet diplomatic prestige.' },
  'Tay Ho':        { population: '~165,000', vibe: 'Expat lakeside, brunch & yoga', bestAreas: ['Quang An', 'Xuan Dieu', 'Tay Ho Peninsula'], blurb: 'Hanoi\'s defining expat district — West Lake views, international restaurants, yoga studios and Sunday brunches.' },
  'Dong Da':       { population: '~370,000', vibe: 'Dense local, university belt', bestAreas: ['Lang Ha', 'Hoang Cau'], blurb: 'Hanoi\'s most populated district — universities, hospitals and a thick layer of authentic street food.' },
  'Hai Ba Trung':  { population: '~315,000', vibe: 'Local-modern, Vincom-anchored', bestAreas: ['Times City', 'Vincom Ba Trieu'], blurb: 'Anchored by Times City — schools, hospitals and mid-luxe Vinhomes towers within walking distance of Hoan Kiem.' },
  'Cau Giay':      { population: '~290,000', vibe: 'New-business, Korean expats', bestAreas: ['Trung Hoa', 'Yen Hoa', 'Cau Giay Park'], blurb: 'Hanoi\'s newer office & business district — a strong Korean expat community, modern apartments and good parks.' },
  'Thanh Xuan':    { population: '~290,000', vibe: 'Mid-luxe, growing high-rises', bestAreas: ['Royal City', 'Nguyen Trai'], blurb: 'Home to Royal City\'s underground megamall and a long spine of new mid-luxe towers.' },
  'Long Bien':     { population: '~340,000', vibe: 'East-bank, master-planned green', bestAreas: ['Vinhomes Riverside', 'Ngoc Thuy'], blurb: 'Across the Red River — leafy villa estates like Vinhomes Riverside and easy airport access.' },
  'Hoang Mai':     { population: '~535,000', vibe: 'South-Hanoi value, Times City overflow', bestAreas: ['Linh Dam', 'Vinh Tuy'], blurb: 'Big lakes, affordable family towers and a fast-growing dining scene around Linh Dam peninsula.' },
};

function centroidOfRings(rings: [number, number][][]): [number, number] {
  let sx = 0, sy = 0, n = 0;
  for (const r of rings) for (const [lat, lng] of r) { sx += lng; sy += lat; n++; }
  return [sy / n, sx / n];
}

type DistrictData = Record<City, { name: string; rings: [number, number][][] }[]>;
const DISTRICT_SHAPES = cityDistrictsData as DistrictData;

function formatBracket(c: Complex): string | null {
  const b = c.average_rent_brackets;
  if (!b) return null;
  const pick = b['2BR'] ?? b['1BR'] ?? b['3BR'] ?? Object.values(b)[0];
  if (!pick || typeof pick.min !== 'number' || typeof pick.max !== 'number') return null;
  return `$${pick.min.toLocaleString()} — $${pick.max.toLocaleString()}`;
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!));
}

interface Props {
  complexes: Complex[];
  focusComplexId?: string;
  focusLatLng?: { lat: number; lng: number; label?: string };
  hideHeader?: boolean;
  hideChrome?: boolean;
  initialCityOverride?: City;
}

export function ComplexMapCanvas({ complexes, focusComplexId, focusLatLng, hideHeader, hideChrome, initialCityOverride }: Props) {
  const navigate = useNavigate();
  const focusComplex = useMemo(
    () => (focusComplexId ? complexes.find((c) => c.id === focusComplexId) : undefined),
    [complexes, focusComplexId],
  );
  const inferredCity: City = focusLatLng
    ? (focusLatLng.lat > 18 ? 'hanoi' : 'ho_chi_minh')
    : ((focusComplex?.city as City) ?? 'ho_chi_minh');
  const initialCity: City = initialCityOverride ?? inferredCity;
  const [city, setCity] = useState<City>(initialCity);

  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any>(null); // L.layerGroup for districts/labels/landmarks/complexes

  const cityComplexes = useMemo(
    () => complexes.filter((c) => c.city === city && c.latitude != null && c.longitude != null),
    [complexes, city],
  );


  // Mount map once
  useEffect(() => {
    if (!mapElRef.current || mapRef.current) return;
    let cancelled = false;
    (async () => {
      const L = await import('leaflet');
      await import('leaflet/dist/leaflet.css');
      if (cancelled || !mapElRef.current) return;

      const map = L.map(mapElRef.current, {
        zoomControl: false,
        scrollWheelZoom: true,
        attributionControl: false,
      });
      mapRef.current = map;

      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '',
        subdomains: 'abcd',
        maxZoom: 19,
      }).addTo(map);

      L.control.zoom({ position: 'bottomright' }).addTo(map);
      overlaysRef.current = L.layerGroup().addTo(map);

      // initial view
      if (focusLatLng) {
        map.setView([focusLatLng.lat, focusLatLng.lng], 15);
      } else {
        const b = BBOX[initialCity];
        map.fitBounds([[b.minLat, b.minLng], [b.maxLat, b.maxLng]], { padding: [20, 20] });
      }


      // Delegated navigation for popup links
      map.on('popupopen', (e: any) => {
        const root: HTMLElement = e.popup.getElement();
        const link = root?.querySelector<HTMLElement>('[data-navigate]');
        if (link) {
          link.addEventListener('click', (ev) => {
            ev.preventDefault();
            navigate(link.getAttribute('data-navigate')!);
            map.closePopup();
          });
        }
      });

      setTimeout(() => map.invalidateSize(), 0);
      setTimeout(() => map.invalidateSize(), 250);
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebuild overlays when city or complexes change
  useEffect(() => {
    const map = mapRef.current;
    const group = overlaysRef.current;
    if (!map || !group) return;

    (async () => {
      const L = await import('leaflet');
      group.clearLayers();

      // Recenter on city
      const b = BBOX[city];
      if (focusComplex && focusComplex.city === city && focusComplex.latitude != null) {
        map.setView([focusComplex.latitude, focusComplex.longitude!], 16);
      } else {
        map.fitBounds([[b.minLat, b.minLng], [b.maxLat, b.maxLng]], { padding: [20, 20] });
      }

      // District polygons
      DISTRICT_SHAPES[city]?.forEach((d) => {
        const hasFacts = !!DISTRICT_FACTS[d.name];
        d.rings.forEach((ring) => {
          const poly = L.polygon(ring as any, {
            color: '#F28D63',
            weight: 1.1,
            opacity: 0.55,
            dashArray: '4 4',
            fillColor: '#F28D63',
            fillOpacity: 0.05,
            interactive: hasFacts,
          });
          if (hasFacts) {
            const f = DISTRICT_FACTS[d.name];
            const html = `
              <div class="hausto-popup-card" style="width:260px;">
                <div style="padding:10px 14px 8px;border-bottom:1px solid rgba(242,141,99,0.15);">
                  <p style="font-size:8px;font-weight:700;color:#F28D63;text-transform:uppercase;letter-spacing:0.18em;margin:0;">District</p>
                  <h4 style="font-family:Georgia,serif;color:#0D4F4A;font-size:16px;line-height:1.15;margin:2px 0 0;">${esc(d.name)}</h4>
                </div>
                <div style="padding:12px 14px;display:flex;flex-direction:column;gap:10px;">
                  <p style="color:rgba(13,79,74,0.75);font-size:11px;line-height:1.5;margin:0;">${esc(f.blurb)}</p>
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                    <div>
                      <p style="font-size:8px;font-weight:700;color:rgba(13,79,74,0.45);text-transform:uppercase;letter-spacing:0.08em;margin:0 0 2px;">Population</p>
                      <p style="color:#0D4F4A;font-size:11px;font-weight:600;margin:0;">${esc(f.population)}</p>
                    </div>
                    <div>
                      <p style="font-size:8px;font-weight:700;color:rgba(13,79,74,0.45);text-transform:uppercase;letter-spacing:0.08em;margin:0 0 2px;">Vibe</p>
                      <p style="color:#0D4F4A;font-size:11px;font-weight:600;line-height:1.2;margin:0;">${esc(f.vibe)}</p>
                    </div>
                  </div>
                  <div>
                    <p style="font-size:8px;font-weight:700;color:rgba(13,79,74,0.45);text-transform:uppercase;letter-spacing:0.08em;margin:0 0 6px;">Best areas</p>
                    <div style="display:flex;flex-wrap:wrap;gap:6px;">
                      ${f.bestAreas.map((a) => `<span style="font-size:10px;color:#0D4F4A;background:rgba(242,141,99,0.1);border:1px solid rgba(242,141,99,0.25);padding:2px 8px;border-radius:999px;">${esc(a)}</span>`).join('')}
                    </div>
                  </div>
                </div>
              </div>`;
            const [clat, clng] = centroidOfRings(d.rings);
            poly.bindPopup(html, { maxWidth: 280, className: 'hausto-popup', autoPan: true });
            poly.on('mouseover', () => poly.setStyle({ fillOpacity: 0.14, weight: 1.6, opacity: 0.9, dashArray: '0' }));
            poly.on('mouseout', () => poly.setStyle({ fillOpacity: 0.05, weight: 1.1, opacity: 0.55, dashArray: '4 4' }));
            poly.on('click', () => poly.openPopup([clat, clng] as any));
          }
          group.addLayer(poly);
        });
      });

      // Place labels (districts + water)
      LABELS[city].forEach((l) => {
        const isWater = l.kind === 'water';
        const cls = isWater
          ? 'font-family:Georgia,serif;font-style:italic;color:rgba(13,79,74,0.55);font-size:11px;letter-spacing:0.05em;'
          : 'font-weight:600;color:rgba(13,79,74,0.7);font-size:9px;text-transform:uppercase;letter-spacing:0.18em;';
        const icon = L.divIcon({
          className: 'hausto-label',
          html: `<span style="${cls}white-space:nowrap;text-shadow:0 1px 0 rgba(255,255,255,0.9),0 0 6px rgba(255,255,255,0.9);">${esc(l.name)}</span>`,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        });
        L.marker([l.lat, l.lng], { icon, interactive: false, keyboard: false }).addTo(group);
      });

      // Landmark pins
      LANDMARKS[city].forEach((lm) => {
        const icon = L.divIcon({
          className: 'hausto-landmark',
          html: `
            <span style="position:relative;display:block;width:24px;height:24px;">
              <span style="position:absolute;top:50%;left:50%;width:10px;height:10px;margin:-5px 0 0 -5px;background:#F28D63;transform:rotate(45deg);box-shadow:0 0 0 2px #fff,0 2px 6px rgba(13,79,74,0.25);"></span>
            </span>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });
        const marker = L.marker([lm.lat, lm.lng], { icon, title: lm.name });
        const html = `
          <div class="hausto-popup-card" style="width:240px;">
            <img src="${esc(lm.image)}" alt="${esc(lm.name)}" loading="lazy" style="width:100%;height:104px;object-fit:cover;background:rgba(13,79,74,0.05);display:block;" />
            <div style="padding:10px 12px 12px;">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;">
                <h4 style="font-family:Georgia,serif;color:#0D4F4A;font-size:14px;line-height:1.15;margin:0;">${esc(lm.name)}</h4>
                <span style="font-size:8px;font-weight:700;color:#F28D63;border:1px solid rgba(242,141,99,0.3);padding:2px 6px;border-radius:3px;letter-spacing:-0.02em;text-transform:uppercase;flex-shrink:0;">Landmark</span>
              </div>
              <p style="color:rgba(13,79,74,0.75);font-size:11px;line-height:1.5;margin:0;">${esc(lm.blurb)}</p>
              ${lm.url ? `<a href="${esc(lm.url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:8px;font-size:10px;font-weight:600;color:#F28D63;text-decoration:none;letter-spacing:0.05em;text-transform:uppercase;">Learn more →</a>` : ''}
            </div>
          </div>`;
        marker.bindPopup(html, { maxWidth: 260, className: 'hausto-popup', autoPan: true });
        group.addLayer(marker);
      });

      // Complex pins
      cityComplexes.forEach((c) => {
        const isFocus = focusComplex?.id === c.id;
        const html = isFocus
          ? `<span style="position:relative;display:block;width:32px;height:32px;">
               <span style="position:absolute;inset:0;border-radius:9999px;background:rgba(242,141,99,0.22);animation:haustoPulse 2.4s ease-out infinite;"></span>
               <span style="position:absolute;top:50%;left:50%;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:9999px;background:#F28D63;box-shadow:0 0 0 3px #fff,0 4px 10px rgba(242,141,99,0.4);"></span>
             </span>`
          : `<span style="display:block;width:12px;height:12px;border-radius:9999px;background:#0D4F4A;box-shadow:0 0 0 2px #fff,0 2px 4px rgba(13,79,74,0.3);"></span>`;
        const icon = L.divIcon({
          className: 'hausto-complex',
          html,
          iconSize: isFocus ? [32, 32] : [12, 12],
          iconAnchor: isFocus ? [16, 16] : [6, 6],
        });
        const marker = L.marker([c.latitude!, c.longitude!], { icon, title: c.name });
        const bracket = formatBracket(c);
        const premium = c.tags?.includes('luxury');
        const popupHtml = `
          <div class="hausto-popup-card" style="width:240px;">
            ${c.hero_image ? `<img src="${esc(c.hero_image)}" alt="${esc(c.name)}" loading="lazy" style="width:100%;height:104px;object-fit:cover;background:rgba(13,79,74,0.05);display:block;" />` : ''}
            <div style="padding:10px 12px 12px;">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px;">
                <a href="/complexes/${esc(c.slug)}" data-navigate="/complexes/${esc(c.slug)}" style="font-family:Georgia,serif;font-weight:700;color:#0D4F4A;font-size:14px;line-height:1.15;text-decoration:none;cursor:pointer;">${esc(c.name)}</a>
                ${premium ? `<span style="font-size:9px;font-weight:700;color:#F28D63;border:1px solid rgba(242,141,99,0.3);padding:2px 6px;border-radius:3px;letter-spacing:-0.02em;flex-shrink:0;">PREMIUM</span>` : ''}
              </div>
              <p style="color:rgba(13,79,74,0.6);font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 10px;">${esc(c.district)}</p>
              ${bracket ? `<div style="display:flex;justify-content:space-between;align-items:baseline;padding-top:8px;border-top:1px solid rgba(13,79,74,0.05);">
                <span style="color:#0D4F4A;font-size:12px;font-weight:600;">${esc(bracket)}</span>
                <span style="color:rgba(13,79,74,0.4);font-size:9px;">USD/mo</span>
              </div>` : ''}
            </div>
          </div>`;
        marker.bindPopup(popupHtml, { maxWidth: 260, className: 'hausto-popup', autoPan: true });
        if (isFocus) setTimeout(() => marker.openPopup(), 300);
        group.addLayer(marker);
      });
    })();
  }, [city, cityComplexes, focusComplex]);

  return (
    <div className="w-full">
      {!hideHeader && (
        <div className="text-center mb-6 md:mb-10 space-y-2 md:space-y-3 px-2">
          <span className="text-[#F28D63] font-semibold tracking-[0.2em] uppercase text-[10px]">
            Curated Residences
          </span>
          <h2 className="text-3xl md:text-5xl text-[#0D4F4A] font-serif font-normal leading-tight">
            The Luxury Map of <em className="italic">{CITY_LABEL[city]}</em>
          </h2>
          <div className="w-12 h-px bg-[#0D4F4A]/20 mx-auto mt-3 md:mt-4" />
        </div>
      )}

      <style>{`
        @keyframes haustoPulse { 0%{transform:scale(0.6);opacity:0.7} 100%{transform:scale(1.6);opacity:0} }
        .hausto-popup .leaflet-popup-content-wrapper { padding:0; border-radius:10px; overflow:hidden; box-shadow:0 12px 40px rgba(13,79,74,0.18); border:1px solid rgba(13,79,74,0.08); background:rgba(255,255,255,0.97); backdrop-filter:blur(8px); }
        .hausto-popup .leaflet-popup-content { margin:0; width:auto !important; }
        .hausto-popup .leaflet-popup-tip { background:rgba(255,255,255,0.97); }
        .hausto-label { background:transparent !important; border:none !important; pointer-events:none; }
        .hausto-landmark, .hausto-complex { background:transparent !important; border:none !important; }
      `}</style>

      <div className="relative w-full aspect-[4/5] sm:aspect-[16/10] lg:aspect-[21/9] bg-[#F3F0E9] rounded-2xl border border-[#0D4F4A]/5 overflow-hidden shadow-2xl shadow-[#0D4F4A]/5">
        <div ref={mapElRef} className="absolute inset-0" style={{ zIndex: 1 }} />

        {/* City toggle */}
        <div className="absolute bottom-3 left-3 sm:bottom-6 sm:left-6 z-[500] flex bg-white/85 backdrop-blur-md rounded-full p-1 border border-[#0D4F4A]/10 shadow-sm">
          {(Object.keys(CITY_LABEL) as City[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setCity(k)}
              className={`px-3 sm:px-4 py-1.5 text-[10px] font-bold rounded-full uppercase tracking-wider transition-colors ${
                city === k
                  ? 'bg-white text-[#0D4F4A] shadow-sm'
                  : 'text-[#0D4F4A]/40 hover:text-[#0D4F4A]'
              }`}
            >
              {CITY_LABEL[k]}
            </button>
          ))}
        </div>

        {/* Hint */}
        <div className="absolute top-3 right-3 sm:top-4 sm:right-4 z-[500] bg-white/75 backdrop-blur-sm rounded-full px-2.5 py-1 text-[9px] uppercase tracking-wider text-[#0D4F4A]/60 pointer-events-none">
          Scroll · Drag · Tap
        </div>

        {cityComplexes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-[#0D4F4A]/50 text-sm pointer-events-none z-[400]">
            No mapped complexes in {CITY_LABEL[city]} yet.
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="mt-6 sm:mt-8 flex flex-wrap justify-center gap-x-6 gap-y-3 sm:gap-x-10 sm:gap-y-4 px-2">
        <div className="flex items-center space-x-2">
          <div className="w-2 h-2 rounded-full bg-[#F28D63]" />
          <span className="text-[#0D4F4A]/50 text-[10px] uppercase font-semibold tracking-widest">
            Active selection
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-2 h-2 rounded-full bg-[#0D4F4A]" />
          <span className="text-[#0D4F4A]/50 text-[10px] uppercase font-semibold tracking-widest">
            Vetted complexes ({cityComplexes.length})
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-[#F28D63] text-[10px]">◆</span>
          <span className="text-[#0D4F4A]/50 text-[10px] uppercase font-semibold tracking-widest">
            Landmarks
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-6 h-px bg-[#F28D63]/40" style={{ borderTop: '1px dashed #F28D63' }} />
          <span className="text-[#0D4F4A]/50 text-[10px] uppercase font-semibold tracking-widest">
            District borders
          </span>
        </div>
      </div>
    </div>
  );
}
