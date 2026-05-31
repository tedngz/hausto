import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Complex } from '@/hooks/useComplexes';
import cityDistrictsData from '@/data/cityDistricts.json';

type City = 'ho_chi_minh' | 'hanoi';

// Geographic bounding boxes — MUST match scripts/generate-city-maps.mjs.
const BBOX: Record<City, { minLat: number; maxLat: number; minLng: number; maxLng: number }> = {
  ho_chi_minh: { minLat: 10.68, maxLat: 10.85, minLng: 106.62, maxLng: 106.83 },
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

// Landmark profiles — clickable pins with editorial mini-cards.
type Landmark = { name: string; lat: number; lng: number; blurb: string; image: string; url?: string };

// Wikimedia Commons hot-link helper — always returns a 600px-wide JPG.
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

// Editorial district quick-facts — surfaced when an outline is clicked.
type DistrictFact = {
  population: string;
  vibe: string;
  bestAreas: string[];
  blurb: string;
};

const DISTRICT_FACTS: Record<string, DistrictFact> = {
  // Ho Chi Minh City
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

  // Hanoi
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

function project(lat: number, lng: number, city: City) {
  const b = BBOX[city];
  const x = ((lng - b.minLng) / (b.maxLng - b.minLng)) * 100;
  const y = (1 - (lat - b.minLat) / (b.maxLat - b.minLat)) * 100;
  return { x, y };
}

function clampPct(p: { x: number; y: number }) {
  return { x: Math.max(2, Math.min(98, p.x)), y: Math.max(3, Math.min(97, p.y)) };
}

function formatBracket(c: Complex): string | null {
  const b = c.average_rent_brackets;
  if (!b) return null;
  const pick = b['2BR'] ?? b['1BR'] ?? b['3BR'] ?? Object.values(b)[0];
  if (!pick || typeof pick.min !== 'number' || typeof pick.max !== 'number') return null;
  return `$${pick.min.toLocaleString()} — $${pick.max.toLocaleString()}`;
}

const MIN_ZOOM = 0.75;
const MAX_ZOOM = 4;

interface Props {
  complexes: Complex[];
}

export function ComplexMapCanvas({ complexes }: Props) {
  const [city, setCity] = useState<City>('ho_chi_minh');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeDistrict, setActiveDistrict] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Tracks one-finger drag or mouse drag
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);
  // Tracks 2-finger pinch
  const pinchRef = useRef<{ startDist: number; startZoom: number; centerX: number; centerY: number; origPanX: number; origPanY: number } | null>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const wasDraggedRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  const cityComplexes = useMemo(
    () => complexes.filter((c) => c.city === city && c.latitude != null && c.longitude != null),
    [complexes, city],
  );

  // Wheel zoom — attach as non-passive so we can preventDefault.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      const delta = -e.deltaY * 0.0015;
      setZoom((prevZoom) => {
        const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, +(prevZoom * (1 + delta)).toFixed(3)));
        const k = next / prevZoom;
        setPan((p) => ({ x: cx - (cx - p.x) * k, y: cy - (cy - p.y) * k }));
        return next;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-map-control]')) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 2) {
      // start pinch
      const pts = Array.from(pointersRef.current.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const midX = (pts[0].x + pts[1].x) / 2 - rect.left - rect.width / 2;
      const midY = (pts[0].y + pts[1].y) / 2 - rect.top - rect.height / 2;
      pinchRef.current = {
        startDist: dist,
        startZoom: zoom,
        centerX: midX,
        centerY: midY,
        origPanX: pan.x,
        origPanY: pan.y,
      };
      dragRef.current = null;
    } else {
      dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pan.x, origY: pan.y, moved: false };
      setIsDragging(true);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinchRef.current && pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const { startDist, startZoom, centerX, centerY, origPanX, origPanY } = pinchRef.current;
      const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, startZoom * (dist / startDist)));
      const k = nextZoom / startZoom;
      setZoom(+nextZoom.toFixed(3));
      setPan({ x: centerX - (centerX - origPanX) * k, y: centerY - (centerY - origPanY) * k });
      return;
    }

    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) > 3) d.moved = true;
    setPan({ x: d.origX + dx, y: d.origY + dy });
  };

  const endPointer = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) {
      wasDraggedRef.current = !!dragRef.current?.moved;
      dragRef.current = null;
      setIsDragging(false);
      if (wasDraggedRef.current) setTimeout(() => { wasDraggedRef.current = false; }, 0);
    }
  };

  const zoomAtCenter = (factor: number) => {
    setZoom((prev) => {
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, +(prev * factor).toFixed(3)));
      const k = next / prev;
      setPan((p) => ({ x: p.x * k, y: p.y * k }));
      return next;
    });
  };

  return (
    <div className="w-full">
      {/* Header */}
      <div className="text-center mb-6 md:mb-10 space-y-2 md:space-y-3 px-2">
        <span className="text-[#F28D63] font-semibold tracking-[0.2em] uppercase text-[10px]">
          Curated Residences
        </span>
        <h2 className="text-3xl md:text-5xl text-[#0D4F4A] font-serif font-normal leading-tight">
          The Luxury Map of <em className="italic">{CITY_LABEL[city]}</em>
        </h2>
        <div className="w-12 h-px bg-[#0D4F4A]/20 mx-auto mt-3 md:mt-4" />
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className={`relative w-full aspect-[4/5] sm:aspect-[16/10] lg:aspect-[21/9] bg-[#F3F0E9] rounded-2xl border border-[#0D4F4A]/5 overflow-hidden shadow-2xl shadow-[#0D4F4A]/5 touch-none ${
          isDragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
      >
        {/* Zoomable + pannable map stage */}
        <div
          className={`absolute inset-0 ${isDragging || pinchRef.current ? '' : 'transition-transform duration-200 ease-out'}`}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
          }}
        >
          <img
            src={`/maps/${city}.svg`}
            alt=""
            aria-hidden
            className="absolute inset-0 w-full h-full pointer-events-none select-none"
            style={{ objectFit: 'fill' }}
          />

          {/* Grid overlay for texture */}
          <div
            className="absolute inset-0 pointer-events-none opacity-[0.05]"
            style={{
              backgroundImage: 'radial-gradient(#0D4F4A 1px, transparent 1px)',
              backgroundSize: '32px 32px',
            }}
          />

          {/* District borders — real OSM admin polygons */}
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden
          >
            <defs>
              <pattern id="districtFill" patternUnits="userSpaceOnUse" width="2" height="2" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="2" stroke="#F28D63" strokeWidth="0.15" strokeOpacity="0.18" />
              </pattern>
            </defs>
            {DISTRICT_SHAPES[city]?.map((d) =>
              d.rings.map((ring, i) => {
                const pts = ring
                  .map(([lat, lng]) => {
                    const p = project(lat, lng, city);
                    return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
                  })
                  .join(' ');
                return (
                  <polygon
                    key={`${d.name}-${i}`}
                    points={pts}
                    fill="url(#districtFill)"
                    stroke="#F28D63"
                    strokeOpacity="0.55"
                    strokeWidth={1.1}
                    strokeDasharray="3 3"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                );
              }),
            )}
          </svg>


          {/* Place name labels (districts + water only) */}
          {LABELS[city].map((l) => {
            const { x, y } = clampPct(project(l.lat, l.lng, city));
            const className =
              l.kind === 'water'
                ? 'text-[#0D4F4A]/55 italic font-serif text-[11px] tracking-wider'
                : 'text-[#0D4F4A]/70 font-semibold text-[9px] uppercase tracking-[0.18em]';
            return (
              <span
                key={l.name}
                className={`absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none whitespace-nowrap ${className}`}
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                  transform: `translate(-50%, -50%) scale(${1 / zoom})`,
                  textShadow: '0 1px 0 rgba(243,240,233,0.9), 0 0 6px rgba(243,240,233,0.9)',
                }}
              >
                {l.name}
              </span>
            );
          })}

          {/* Landmark pins — clickable diamond markers with profile cards */}
          {LANDMARKS[city].map((lm) => {
            const { x, y } = clampPct(project(lm.lat, lm.lng, city));
            const key = `lm-${lm.name}`;
            const isActive = activeId === key;
            const flipUp = y > 55;
            const flipLeft = x > 70;
            const flipRight = x < 30;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  if (wasDraggedRef.current) return;
                  setActiveId(isActive ? null : key);
                }}
                onMouseEnter={() => { if (!isDragging) setActiveId(key); }}
                className="group absolute -translate-x-1/2 -translate-y-1/2 z-[9]"
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                  transform: `translate(-50%, -50%) scale(${1 / zoom})`,
                }}
                aria-label={lm.name}
              >
                <span className={`block w-2.5 h-2.5 bg-[#F28D63] ring-2 ring-white shadow-md rotate-45 ${isActive ? 'scale-125' : ''} transition-transform`} />
                {!isActive && (
                  <span className="absolute top-4 left-1/2 -translate-x-1/2 text-[9px] font-semibold text-[#F28D63]/85 whitespace-nowrap tracking-wider">
                    {lm.name}
                  </span>
                )}
                {isActive && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className={`absolute w-56 sm:w-64 bg-white/95 backdrop-blur-md rounded-lg shadow-2xl border border-[#F28D63]/20 overflow-hidden text-left z-30 ${
                      flipUp ? 'bottom-6' : 'top-6'
                    } ${flipLeft ? 'right-0' : flipRight ? 'left-0' : 'left-1/2 -translate-x-1/2'}`}
                  >
                    <img src={lm.image} alt={lm.name} loading="lazy" className="w-full h-24 sm:h-28 object-cover bg-[#0D4F4A]/5" />
                    <div className="p-3 sm:p-4">
                      <div className="flex items-center justify-between mb-1.5 gap-2">
                        <h4 className="text-[#0D4F4A] font-serif text-sm sm:text-base leading-tight">{lm.name}</h4>
                        <span className="text-[8px] font-bold text-[#F28D63] border border-[#F28D63]/30 px-1.5 py-0.5 rounded tracking-tighter shrink-0 uppercase">
                          Landmark
                        </span>
                      </div>
                      <p className="text-[#0D4F4A]/75 text-[11px] leading-relaxed">{lm.blurb}</p>
                      {lm.url && (
                        <a
                          href={lm.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block mt-2 text-[10px] font-semibold text-[#F28D63] hover:underline tracking-wider uppercase"
                        >
                          Learn more →
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </button>
            );
          })}


          {/* Pins */}
          {cityComplexes.map((c) => {
            const { x, y } = clampPct(project(c.latitude!, c.longitude!, city));
            const isActive = c.id === activeId;
            const flipUp = y > 55;
            const flipLeft = x > 70;
            const flipRight = x < 30;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  if (wasDraggedRef.current) return;
                  setActiveId(isActive ? null : c.id);
                }}
                onMouseEnter={() => { if (!isDragging) setActiveId(c.id); }}
                className="group absolute -translate-x-1/2 -translate-y-1/2 z-10"
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                  transform: `translate(-50%, -50%) scale(${1 / zoom})`,
                }}
                aria-label={c.name}
              >
                {isActive ? (
                  <span className="block w-4 h-4 bg-[#F28D63] rounded-full ring-4 ring-white shadow-lg animate-pulse" />
                ) : (
                  <span className="block w-2.5 h-2.5 bg-[#0D4F4A] rounded-full ring-2 ring-white shadow-md group-hover:bg-[#F28D63] transition-colors" />
                )}
                {!isActive && (
                  <span className="absolute top-5 left-1/2 -translate-x-1/2 text-[9px] font-bold text-[#0D4F4A]/70 whitespace-nowrap uppercase tracking-tight opacity-0 group-hover:opacity-100 transition-opacity">
                    {c.name}
                  </span>
                )}

                {isActive && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className={`absolute w-56 sm:w-64 bg-white/95 backdrop-blur-md rounded-lg shadow-2xl border border-[#0D4F4A]/10 overflow-hidden text-left z-30 ${
                      flipUp ? 'bottom-7' : 'top-7'
                    } ${flipLeft ? 'right-0' : flipRight ? 'left-0' : 'left-1/2 -translate-x-1/2'}`}
                  >
                    {c.hero_image && (
                      <img
                        src={c.hero_image}
                        alt={c.name}
                        className="w-full h-24 sm:h-28 object-cover bg-[#0D4F4A]/5"
                        loading="lazy"
                      />
                    )}
                    <div className="p-3 sm:p-4">
                      <div className="flex justify-between items-start mb-2 gap-2">
                        <Link
                          to={`/complexes/${c.slug}`}
                          className="text-[#0D4F4A] font-serif font-bold text-sm sm:text-base leading-tight hover:text-[#F28D63] transition-colors"
                        >
                          {c.name}
                        </Link>
                        {c.tags?.includes('luxury') && (
                          <span className="text-[9px] font-bold text-[#F28D63] border border-[#F28D63]/30 px-1.5 py-0.5 rounded tracking-tighter shrink-0">
                            PREMIUM
                          </span>
                        )}
                      </div>
                      <p className="text-[#0D4F4A]/60 text-[10px] font-medium uppercase tracking-wider mb-3">
                        {c.district}
                      </p>
                      {formatBracket(c) && (
                        <div className="flex justify-between items-baseline pt-2 border-t border-[#0D4F4A]/5">
                          <span className="text-[#0D4F4A] text-xs font-semibold">{formatBracket(c)}</span>
                          <span className="text-[#0D4F4A]/40 text-[9px]">USD/mo</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Vignette */}
        <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-[#F3F0E9]/40 via-transparent to-[#F3F0E9]/40 z-20" />

        {/* City toggle */}
        <div data-map-control className="absolute bottom-3 left-3 sm:bottom-6 sm:left-6 z-40 flex bg-white/80 backdrop-blur-md rounded-full p-1 border border-[#0D4F4A]/10 shadow-sm">
          {(Object.keys(CITY_LABEL) as City[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setCity(k);
                setActiveId(null);
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
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

        {/* Zoom controls */}
        <div data-map-control className="absolute bottom-3 right-3 sm:bottom-6 sm:right-6 z-40 flex flex-col space-y-1">
          <button
            type="button"
            onClick={() => zoomAtCenter(1.25)}
            className="w-9 h-9 sm:w-8 sm:h-8 flex items-center justify-center bg-white/85 backdrop-blur-sm border border-[#0D4F4A]/10 rounded-md text-[#0D4F4A] text-base sm:text-sm font-bold shadow-sm hover:bg-white"
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => zoomAtCenter(0.8)}
            className="w-9 h-9 sm:w-8 sm:h-8 flex items-center justify-center bg-white/85 backdrop-blur-sm border border-[#0D4F4A]/10 rounded-md text-[#0D4F4A] text-base sm:text-sm font-bold shadow-sm hover:bg-white"
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
            className="w-9 h-9 sm:w-8 sm:h-8 flex items-center justify-center bg-white/85 backdrop-blur-sm border border-[#0D4F4A]/10 rounded-md text-[#0D4F4A] text-[10px] sm:text-[9px] font-bold shadow-sm hover:bg-white uppercase tracking-wider"
            aria-label="Reset view"
          >
            ⟲
          </button>
        </div>

        {/* Hint */}
        <div data-map-control className="absolute top-3 right-3 sm:top-4 sm:right-4 z-40 bg-white/70 backdrop-blur-sm rounded-full px-2.5 py-1 text-[9px] uppercase tracking-wider text-[#0D4F4A]/60 hidden sm:block">
          Scroll to zoom · Drag to pan
        </div>
        <div data-map-control className="absolute top-3 right-3 z-40 bg-white/70 backdrop-blur-sm rounded-full px-2.5 py-1 text-[9px] uppercase tracking-wider text-[#0D4F4A]/60 sm:hidden">
          Pinch · Drag
        </div>

        {cityComplexes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-[#0D4F4A]/50 text-sm">
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
          <div className="w-6 h-px bg-[#0D4F4A]/20" />
          <span className="text-[#0D4F4A]/50 text-[10px] uppercase font-semibold tracking-widest">
            Primary waterways
          </span>
        </div>
      </div>

      <p className="mt-4 text-center text-[10px] text-[#0D4F4A]/30 tracking-wider">
        Geography © OpenStreetMap contributors
      </p>
    </div>
  );
}
