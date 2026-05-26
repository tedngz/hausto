import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Complex } from '@/hooks/useComplexes';

type City = 'ho_chi_minh' | 'hanoi';

// Geographic bounding boxes (approximate, tuned for premium districts).
const BBOX: Record<City, { minLat: number; maxLat: number; minLng: number; maxLng: number }> = {
  ho_chi_minh: { minLat: 10.68, maxLat: 10.85, minLng: 106.62, maxLng: 106.83 },
  hanoi:       { minLat: 20.97, maxLat: 21.10, minLng: 105.74, maxLng: 105.93 },
};

const CITY_LABEL: Record<City, string> = {
  ho_chi_minh: 'Saigon',
  hanoi: 'Hanoi',
};

function project(lat: number, lng: number, city: City) {
  const b = BBOX[city];
  const x = ((lng - b.minLng) / (b.maxLng - b.minLng)) * 100;
  // invert Y: north (higher lat) at top
  const y = (1 - (lat - b.minLat) / (b.maxLat - b.minLat)) * 100;
  return { x: Math.max(4, Math.min(96, x)), y: Math.max(6, Math.min(94, y)) };
}

function formatBracket(c: Complex): string | null {
  const b = c.average_rent_brackets;
  if (!b) return null;
  const pick = b['2BR'] ?? b['1BR'] ?? b['3BR'] ?? Object.values(b)[0];
  if (!pick || typeof pick.min !== 'number' || typeof pick.max !== 'number') return null;
  return `$${pick.min.toLocaleString()} — $${pick.max.toLocaleString()}`;
}

interface Props {
  complexes: Complex[];
}

export function ComplexMapCanvas({ complexes }: Props) {
  const [city, setCity] = useState<City>('ho_chi_minh');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  const cityComplexes = useMemo(
    () => complexes.filter((c) => c.city === city && c.latitude != null && c.longitude != null),
    [complexes, city],
  );

  const active = cityComplexes.find((c) => c.id === activeId) ?? null;

  return (
    <div className="w-full">
      {/* Header */}
      <div className="text-center mb-10 space-y-3">
        <span className="text-[#F28D63] font-semibold tracking-[0.2em] uppercase text-[10px]">
          Curated Residences
        </span>
        <h2 className="text-4xl md:text-5xl text-[#0D4F4A] font-serif font-normal">
          The Luxury Map of <em className="italic">{CITY_LABEL[city]}</em>
        </h2>
        <div className="w-12 h-px bg-[#0D4F4A]/20 mx-auto mt-4" />
      </div>

      {/* Canvas */}
      <div className="relative w-full aspect-[16/10] lg:aspect-[21/9] bg-[#F3F0E9] rounded-2xl border border-[#0D4F4A]/5 overflow-hidden shadow-2xl shadow-[#0D4F4A]/5">
        {/* Real OSM-derived city map */}
        <img
          src={`/maps/${city}.svg`}
          alt=""
          aria-hidden
          className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none"
        />

        {/* Grid overlay for texture */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.05]"
          style={{
            backgroundImage: 'radial-gradient(#0D4F4A 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        />

        {/* Subtle vignette to keep edges editorial */}
        <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-[#F3F0E9]/40 via-transparent to-[#F3F0E9]/40" />

        {/* Pins layer with zoom transform */}
        <div
          className="absolute inset-0 transition-transform duration-300 ease-out"
          style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
        >
          {cityComplexes.map((c) => {
            const { x, y } = project(c.latitude!, c.longitude!, city);
            const isActive = c.id === activeId;
            const flipUp = y > 55; // place card above pin if pin is in lower half
            const flipLeft = x > 70;
            const flipRight = x < 30;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveId(isActive ? null : c.id)}
                onMouseEnter={() => setActiveId(c.id)}
                className="group absolute -translate-x-1/2 -translate-y-1/2 z-10"
                style={{ left: `${x}%`, top: `${y}%` }}
                aria-label={c.name}
              >
                {isActive ? (
                  <>
                    <span className="block w-4 h-4 bg-[#F28D63] rounded-full ring-4 ring-white shadow-lg animate-pulse" />
                  </>
                ) : (
                  <span className="block w-2.5 h-2.5 bg-[#0D4F4A] rounded-full ring-2 ring-white shadow-md group-hover:bg-[#F28D63] transition-colors" />
                )}
                {!isActive && (
                  <span className="absolute top-5 left-1/2 -translate-x-1/2 text-[9px] font-bold text-[#0D4F4A]/60 whitespace-nowrap uppercase tracking-tight opacity-0 group-hover:opacity-100 transition-opacity">
                    {c.name}
                  </span>
                )}

                {/* Active mini card */}
                {isActive && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className={`absolute w-64 bg-white/95 backdrop-blur-md rounded-lg shadow-2xl border border-[#0D4F4A]/10 overflow-hidden text-left z-30 ${
                      flipUp ? 'bottom-7' : 'top-7'
                    } ${flipLeft ? 'right-0' : flipRight ? 'left-0' : 'left-1/2 -translate-x-1/2'}`}
                  >
                    {c.hero_image && (
                      <img
                        src={c.hero_image}
                        alt={c.name}
                        className="w-full h-28 object-cover bg-[#0D4F4A]/5"
                        loading="lazy"
                      />
                    )}
                    <div className="p-4">
                      <div className="flex justify-between items-start mb-2 gap-2">
                        <Link
                          to={`/complexes/${c.slug}`}
                          className="text-[#0D4F4A] font-serif font-bold text-base leading-tight hover:text-[#F28D63] transition-colors"
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

        {/* City toggle */}
        <div className="absolute bottom-6 left-6 z-40 flex bg-white/70 backdrop-blur-md rounded-full p-1 border border-[#0D4F4A]/10 shadow-sm">
          {(Object.keys(CITY_LABEL) as City[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setCity(k);
                setActiveId(null);
              }}
              className={`px-4 py-1.5 text-[10px] font-bold rounded-full uppercase tracking-wider transition-colors ${
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
        <div className="absolute bottom-6 right-6 z-40 flex flex-col space-y-1">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.25).toFixed(2)))}
            className="w-8 h-8 flex items-center justify-center bg-white/80 backdrop-blur-sm border border-[#0D4F4A]/10 rounded-md text-[#0D4F4A] text-sm font-bold shadow-sm hover:bg-white"
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.75, +(z - 0.25).toFixed(2)))}
            className="w-8 h-8 flex items-center justify-center bg-white/80 backdrop-blur-sm border border-[#0D4F4A]/10 rounded-md text-[#0D4F4A] text-sm font-bold shadow-sm hover:bg-white"
            aria-label="Zoom out"
          >
            −
          </button>
        </div>

        {cityComplexes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-[#0D4F4A]/50 text-sm">
            No mapped complexes in {CITY_LABEL[city]} yet.
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="mt-8 flex flex-wrap justify-center gap-x-10 gap-y-4">
        <div className="flex items-center space-x-2">
          <div className="w-2 h-2 rounded-full bg-[#F28D63]" />
          <span className="text-[#0D4F4A]/50 text-[10px] uppercase font-semibold tracking-widest">
            Active selection
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-2 h-2 rounded-full bg-[#0D4F4A]" />
          <span className="text-[#0D4F4A]/50 text-[10px] uppercase font-semibold tracking-widest">
            Vetted complexes
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-6 h-px bg-[#0D4F4A]/20" />
          <span className="text-[#0D4F4A]/50 text-[10px] uppercase font-semibold tracking-widest">
            Primary waterways
          </span>
        </div>
      </div>
    </div>
  );
}
