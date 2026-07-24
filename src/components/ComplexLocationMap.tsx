import { useState } from 'react';
import { MapPin, ExternalLink } from 'lucide-react';
import type { Complex } from '@/hooks/useComplexes';

type City = 'ho_chi_minh' | 'hanoi';

const BBOX: Record<City, { minLat: number; maxLat: number; minLng: number; maxLng: number }> = {
  ho_chi_minh: { minLat: 10.68, maxLat: 10.85, minLng: 106.62, maxLng: 106.83 },
  hanoi:       { minLat: 20.97, maxLat: 21.10, minLng: 105.74, maxLng: 105.93 },
};

type Label = { name: string; lat: number; lng: number; kind: 'district' | 'water' };

const LABELS: Record<City, Label[]> = {
  ho_chi_minh: [
    { name: 'District 1', lat: 10.7769, lng: 106.7009, kind: 'district' },
    { name: 'Thao Dien', lat: 10.8030, lng: 106.7400, kind: 'district' },
    { name: 'Thu Thiem', lat: 10.7720, lng: 106.7220, kind: 'district' },
    { name: 'District 3', lat: 10.7820, lng: 106.6850, kind: 'district' },
    { name: 'District 4', lat: 10.7590, lng: 106.7050, kind: 'district' },
    { name: 'District 7 · PMH', lat: 10.7300, lng: 106.7220, kind: 'district' },
    { name: 'Binh Thanh', lat: 10.8050, lng: 106.7000, kind: 'district' },
    { name: 'Phu Nhuan', lat: 10.7950, lng: 106.6780, kind: 'district' },
    { name: 'Saigon River', lat: 10.7850, lng: 106.7320, kind: 'water' },
  ],
  hanoi: [
    { name: 'Hoan Kiem', lat: 21.0285, lng: 105.8520, kind: 'district' },
    { name: 'Ba Dinh', lat: 21.0370, lng: 105.8290, kind: 'district' },
    { name: 'Tay Ho', lat: 21.0700, lng: 105.8200, kind: 'district' },
    { name: 'Dong Da', lat: 21.0120, lng: 105.8290, kind: 'district' },
    { name: 'Hai Ba Trung', lat: 21.0040, lng: 105.8570, kind: 'district' },
    { name: 'Cau Giay', lat: 21.0310, lng: 105.7960, kind: 'district' },
    { name: 'West Lake', lat: 21.0580, lng: 105.8170, kind: 'water' },
    { name: 'Red River', lat: 21.0500, lng: 105.8800, kind: 'water' },
  ],
};

function project(lat: number, lng: number, city: City) {
  const b = BBOX[city];
  const x = ((lng - b.minLng) / (b.maxLng - b.minLng)) * 100;
  const y = (1 - (lat - b.minLat) / (b.maxLat - b.minLat)) * 100;
  return { x, y };
}

interface Props {
  complex: Complex;
}

export function ComplexLocationMap({ complex }: Props) {
  const [zoom, setZoom] = useState(3);
  if (complex.latitude == null || complex.longitude == null) return null;
  const city = complex.city as City;
  if (!BBOX[city]) return null;

  const center = project(complex.latitude, complex.longitude, city);
  // Pan the stage so the complex coordinate sits in the middle of the viewport.
  const tx = 50 - center.x * zoom;
  const ty = 50 - center.y * zoom;

  const osmUrl = `https://www.openstreetmap.org/?mlat=${complex.latitude}&mlon=${complex.longitude}#map=16/${complex.latitude}/${complex.longitude}`;

  return (
    <section>
      <div className="flex items-end justify-between mb-4">
        <h2 className="font-serif text-2xl">Location</h2>
        <a
          href={osmUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"
        >
          Open in OpenStreetMap <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      </div>

      <div className="relative w-full aspect-[16/10] bg-[#F3F0E9] rounded-2xl border border-[#0D4F4A]/10 overflow-hidden shadow-lg">
        {/* Zoomed map stage */}
        <div
          className="absolute inset-0 transition-transform duration-300 ease-out"
          style={{
            transform: `translate(${tx}%, ${ty}%) scale(${zoom})`,
            transformOrigin: '0 0',
          }}
        >
          <img loading="lazy"
            src={`/maps/${city}.svg`}
            alt=""
            aria-hidden
            className="absolute inset-0 w-full h-full pointer-events-none select-none"
            style={{ objectFit: 'fill' }}
          />

          {/* Nearby labels */}
          {LABELS[city].map((l) => {
            const { x, y } = project(l.lat, l.lng, city);
            const isWater = l.kind === 'water';
            return (
              <span
                key={l.name}
                className={`absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none whitespace-nowrap ${
                  isWater
                    ? 'text-[#0D4F4A]/55 italic font-serif text-[11px] tracking-wider'
                    : 'text-[#0D4F4A]/70 font-semibold text-[9px] uppercase tracking-[0.18em]'
                }`}
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

          {/* This complex pin */}
          <div
            className="absolute -translate-x-1/2 -translate-y-1/2 z-10"
            style={{
              left: `${center.x}%`,
              top: `${center.y}%`,
              transform: `translate(-50%, -50%) scale(${1 / zoom})`,
            }}
          >
            <div className="relative flex flex-col items-center">
              <span className="absolute inline-flex h-6 w-6 rounded-full bg-[#F28D63]/40 animate-ping" />
              <span className="relative block w-4 h-4 bg-[#F28D63] rounded-full ring-4 ring-white shadow-lg" />
              <span className="mt-1 px-2 py-0.5 rounded bg-white/95 text-[#0D4F4A] font-serif text-[10px] font-semibold whitespace-nowrap shadow">
                {complex.name}
              </span>
            </div>
          </div>
        </div>

        {/* Vignette */}
        <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-[#F3F0E9]/40 via-transparent to-[#F3F0E9]/40 z-20" />

        {/* Address chip */}
        <div className="absolute top-4 left-4 z-30 bg-white/85 backdrop-blur-md rounded-lg px-3 py-2 shadow-sm border border-[#0D4F4A]/10 flex items-center gap-2 max-w-[70%]">
          <MapPin className="h-3.5 w-3.5 text-[#F28D63] shrink-0" aria-hidden="true" />
          <span className="text-[11px] font-medium text-[#0D4F4A] truncate">
            {complex.district}
          </span>
        </div>

        {/* Zoom controls */}
        <div className="absolute bottom-4 right-4 z-30 flex flex-col space-y-1">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(6, +(z + 0.5).toFixed(2)))}
            className="w-8 h-8 flex items-center justify-center bg-white/85 backdrop-blur-sm border border-[#0D4F4A]/10 rounded-md text-[#0D4F4A] text-sm font-bold shadow-sm hover:bg-white"
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(1.5, +(z - 0.5).toFixed(2)))}
            className="w-8 h-8 flex items-center justify-center bg-white/85 backdrop-blur-sm border border-[#0D4F4A]/10 rounded-md text-[#0D4F4A] text-sm font-bold shadow-sm hover:bg-white"
            aria-label="Zoom out"
          >
            −
          </button>
        </div>
      </div>

      <p className="mt-3 text-center text-[10px] text-[#0D4F4A]/40 tracking-wider">
        Geography © OpenStreetMap contributors
      </p>
    </section>
  );
}
