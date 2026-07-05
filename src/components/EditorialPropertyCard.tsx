import { useState, useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Heart, MapPin, Loader2, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MapViewModal } from '@/components/MapViewModal';
import { useCurrency } from '@/contexts/CurrencyContext';
import { toast } from '@/hooks/use-toast';
import { translateLocationToEnglish } from '@/utils/locationTranslation';
import { normalizeRepeatedTitle } from '@/utils/normalizeTitle';
import { getVibeRatingLabel } from '@/utils/vibeRating';
import { geocodeLocation } from '@/utils/geocoding';

// Editorial magazine-cover property card with an image slideshow.
// The photo carries the card: title/location appear on the first image only,
// while the current photo's AI highlight, spec and price stay visible at all
// times. The vibe match rating chip opens a scoring-details popover.

export interface EditorialApartment {
  id: string;
  images: string[];
  title: string;
  location: string;
  price: number;
  size?: string | null;
  rooms?: string | null;
  vibe?: string | null;
  description?: string | null;
  highlights?: string[];
  vibe_analysis?: any;
  latitude?: number | null;
  longitude?: number | null;
}

export interface VibeScoreDetails {
  overall: number; // 0-100
  breakdown?: {
    style?: number;
    color?: number;
    activities?: number;
    price?: number;
    location?: number;
  };
}

interface VibeAttribute {
  label: string;
  matched: boolean;
}

export interface VibeMatchAttributes {
  style: VibeAttribute[];
  color: VibeAttribute[];
  lifestyle: VibeAttribute[];
}

interface EditorialPropertyCardProps {
  apartment: EditorialApartment;
  /** 0-100 match score; rendered as a rating chip (casual/good/strong/perfect) with a details popover */
  vibeScore?: VibeScoreDetails;
  /** Detected style/color/lifestyle attributes with match flags — shown in the vibe popover */
  vibeMatch?: VibeMatchAttributes;
  /** Prose shown in the scoring popover when no attributes exist (e.g. the AI match reason) */
  vibeDetailsText?: string;
  /** Quote shown when the current image has no per-image highlight */
  quoteFallback?: string;
  onCardClick?: () => void;
  liked?: boolean;
  onLike?: () => void;
  onContact?: () => void;
  initialImageIndex?: number;
  onImageIndexChange?: (index: number) => void;
  /** Override the card's aspect ratio (default: editorial 380/560 portrait) */
  aspectClass?: string;
  /** Smaller typography so the photo dominates (used in the AI chat's compact cards) */
  compact?: boolean;
  className?: string;
}

const EASE = 'cubic-bezier(0.22,1,0.36,1)';

const RATING_DOT: Record<string, string> = {
  perfect: 'bg-emerald-400',
  strong: 'bg-blue-400',
  good: 'bg-orange-400',
  casual: 'bg-gray-300',
};

// Aesthetic dimensions (the "vibe") shown as attribute chips.
const ATTRIBUTE_GROUPS: Array<{ key: 'style' | 'color' | 'lifestyle'; label: string }> = [
  { key: 'style', label: 'Style' },
  { key: 'color', label: 'Colors' },
  { key: 'lifestyle', label: 'Lifestyle' },
];

// Practical dimensions shown as a compact fit indicator, not a competing bar.
const fitFromScore = (score?: number): { label: string; ok: boolean } | null => {
  if (typeof score !== 'number') return null;
  if (score >= 100) return { label: 'Perfect', ok: true };
  if (score >= 60) return { label: 'Close', ok: true };
  return { label: 'Off', ok: false };
};

export const EditorialPropertyCard = ({
  apartment,
  vibeScore,
  vibeMatch,
  vibeDetailsText,
  quoteFallback,
  onCardClick,
  liked,
  onLike,
  onContact,
  initialImageIndex = 0,
  onImageIndexChange,
  aspectClass = 'aspect-[380/560]',
  compact = false,
  className = '',
}: EditorialPropertyCardProps) => {
  const images = apartment.images && apartment.images.length > 0 ? apartment.images : ['/placeholder-property.jpg'];
  const [current, setCurrent] = useState(Math.min(initialImageIndex, images.length - 1));
  const [hover, setHover] = useState(false);
  const [noHover, setNoHover] = useState(false);
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [geocodedCoords, setGeocodedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const { formatPrice } = useCurrency();

  // Touch devices have no hover: keep the slideshow arrows visible.
  useEffect(() => {
    const mq = window.matchMedia('(hover: none)');
    setNoHover(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setNoHover(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const go = (delta: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrent(c => {
      const next = (c + delta + images.length) % images.length;
      onImageIndexChange?.(next);
      return next;
    });
  };

  const displayTitle = useMemo(() => normalizeRepeatedTitle(apartment.title ?? ''), [apartment.title]);
  const displayLocation = useMemo(() => translateLocationToEnglish(apartment.location), [apartment.location]);

  // Per-image AI highlight for the photo currently in view.
  const imageHighlight = useMemo(() => {
    const analyses = apartment.vibe_analysis?.image_analyses;
    if (!Array.isArray(analyses)) return undefined;
    const match = analyses.find((a: any) => Number(a?.image_index) === current);
    const text = match?.image_highlight || match?.highlight;
    return typeof text === 'string' && text.trim() ? text.trim() : undefined;
  }, [apartment.vibe_analysis, current]);

  const fallbackQuote = useMemo(() => {
    if (quoteFallback?.trim()) return quoteFallback.trim();
    if (apartment.vibe?.trim()) return apartment.vibe.trim();
    const desc = apartment.description?.trim();
    if (desc) return desc.length > 110 ? `${desc.slice(0, 107).trimEnd()}…` : desc;
    return '';
  }, [quoteFallback, apartment.vibe, apartment.description]);

  const quote = imageHighlight || fallbackQuote;
  const spec = [apartment.rooms, apartment.size].filter(s => s && String(s).trim()).join(' · ');
  const arrowsVisible = hover || noHover;
  const isFirstImage = current === 0;

  const ratingLabel = vibeScore ? getVibeRatingLabel(Number(vibeScore.overall)) : null;

  const hasCoords = !!(apartment.latitude && apartment.longitude);
  const mapLat = hasCoords ? apartment.latitude! : geocodedCoords?.lat ?? 0;
  const mapLng = hasCoords ? apartment.longitude! : geocodedCoords?.lng ?? 0;

  const handleLocationClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasCoords || geocodedCoords) {
      setIsMapOpen(true);
      return;
    }
    setIsGeocoding(true);
    try {
      const coords = await geocodeLocation(apartment.location);
      if (coords) {
        setGeocodedCoords(coords);
        setIsMapOpen(true);
      } else {
        toast({ title: 'Location not found', description: 'Could not find this address on the map.', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Geocoding failed', description: 'Could not look up the location.', variant: 'destructive' });
    } finally {
      setIsGeocoding(false);
    }
  };

  return (
    <div
      className={`group relative w-full ${aspectClass} overflow-hidden rounded-[20px] bg-foreground shadow-[0_24px_60px_-24px_rgba(0,0,0,0.45)] select-none ${onCardClick ? 'cursor-pointer' : ''} ${className}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onCardClick}
      role={onCardClick ? 'button' : undefined}
    >
      {/* Slideshow image */}
      <img
        src={images[current]}
        alt={`${displayTitle} — photo ${current + 1} of ${images.length}`}
        className="absolute inset-0 w-full h-full object-cover"
        style={{ transition: `transform 1200ms ${EASE}`, transform: hover ? 'scale(1.07)' : 'scale(1)' }}
        onError={e => {
          const target = e.target as HTMLImageElement;
          target.onerror = null;
          target.src = '/placeholder-property.jpg';
        }}
      />

      {/* Scrim for text legibility */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.40) 0%, rgba(0,0,0,0) 34%, rgba(0,0,0,0) 48%, rgba(0,0,0,0.80) 100%)' }}
      />

      {/* Story-style progress segments */}
      {images.length > 1 && (
        <div className="absolute top-2.5 left-4 right-4 flex gap-1">
          {images.map((_, i) => (
            <span
              key={i}
              className={`h-[2px] flex-1 rounded-full transition-colors duration-300 ${i === current ? 'bg-white/95' : 'bg-white/30'}`}
            />
          ))}
        </div>
      )}

      {/* Top row: vibe match rating chip (left) + like (right) */}
      <div className="absolute top-5 left-5 right-5 flex items-start justify-between">
        {ratingLabel ? (
          <Popover>
            <PopoverTrigger asChild>
              <button
                aria-label="View match scoring details"
                className="flex items-center gap-1.5 rounded-full bg-black/35 backdrop-blur-md px-3 py-1.5 text-white hover:bg-black/55 transition-colors"
                onClick={e => e.stopPropagation()}
              >
                <span className={`w-2 h-2 rounded-full ${RATING_DOT[ratingLabel] || 'bg-gray-300'}`} />
                <span className="font-mono text-[11px] tracking-[0.14em] uppercase">{ratingLabel} match</span>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-4" align="start" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-foreground">Vibe match</span>
                <span className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${RATING_DOT[ratingLabel!] || 'bg-gray-300'}`} />
                  <span className="text-xs font-medium capitalize text-foreground">{ratingLabel}</span>
                </span>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                How this home fits the taste and budget from your quiz.
              </p>

              {vibeMatch && (vibeMatch.style.length + vibeMatch.color.length + vibeMatch.lifestyle.length) > 0 ? (
                <div className="space-y-2.5">
                  {ATTRIBUTE_GROUPS.map(({ key, label }) => {
                    const items = vibeMatch[key];
                    if (!items || items.length === 0) return null;
                    return (
                      <div key={key}>
                        <p className="text-[11px] font-medium text-muted-foreground mb-1">{label}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {items.map((a, j) => (
                            <span
                              key={j}
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] capitalize border ${
                                a.matched
                                  ? 'bg-primary/10 border-primary/40 text-primary font-medium'
                                  : 'bg-transparent border-border text-muted-foreground'
                              }`}
                            >
                              {a.matched && <Check className="w-2.5 h-2.5" />}
                              {a.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}

                  {/* Practical fit: budget + location as compact indicators */}
                  {(() => {
                    const budget = fitFromScore(vibeScore!.breakdown?.price);
                    const location = fitFromScore(vibeScore!.breakdown?.location);
                    if (!budget && !location) return null;
                    return (
                      <div className="flex items-center gap-4 pt-1 mt-1 border-t border-border">
                        {budget && (
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            {budget.ok ? <Check className="w-3 h-3 text-emerald-500" /> : <X className="w-3 h-3 text-muted-foreground" />}
                            Budget · {budget.label}
                          </span>
                        )}
                        {location && (
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            {location.ok ? <Check className="w-3 h-3 text-emerald-500" /> : <X className="w-3 h-3 text-muted-foreground" />}
                            Location · {location.label}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              ) : vibeDetailsText ? (
                <p className="text-xs text-foreground/90 leading-relaxed">{vibeDetailsText}</p>
              ) : (
                <p className="text-xs text-muted-foreground">A quick read on how this home matches your style, colors and lifestyle.</p>
              )}
            </PopoverContent>
          </Popover>
        ) : <span />}

        {onLike && (
          <Button
            size="icon"
            variant="secondary"
            aria-label={liked ? 'Unlike property' : 'Like property'}
            className={`w-8 h-8 rounded-full border-0 backdrop-blur-md transition-all ${liked ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-white/20 text-white hover:bg-white/40'}`}
            onClick={e => {
              e.stopPropagation();
              onLike();
            }}
          >
            <Heart className={`w-4 h-4 ${liked ? 'fill-current' : ''}`} />
          </Button>
        )}
      </div>

      {/* Slideshow arrows */}
      {images.length > 1 && (
        <>
          <button
            aria-label="Previous photo"
            className={`absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/25 text-white backdrop-blur-md flex items-center justify-center transition-opacity duration-300 hover:bg-black/45 ${arrowsVisible ? 'opacity-90' : 'opacity-0'} focus-visible:opacity-90`}
            onClick={e => go(-1, e)}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            aria-label="Next photo"
            className={`absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/25 text-white backdrop-blur-md flex items-center justify-center transition-opacity duration-300 hover:bg-black/45 ${arrowsVisible ? 'opacity-90' : 'opacity-0'} focus-visible:opacity-90`}
            onClick={e => go(1, e)}
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </>
      )}

      {/* Bottom content stack — always visible, no hover needed */}
      <div className={`absolute text-white text-left flex flex-col ${compact ? 'left-4 right-4 bottom-4 gap-1.5' : 'left-5 right-5 bottom-5 gap-2.5'}`}>
        {/* Title + location live on the cover (first image) only */}
        {isFirstImage && (
          <div className={`flex flex-col ${compact ? 'gap-1' : 'gap-1.5'}`}>
            <h3 className={`font-serif font-medium leading-snug [text-wrap:pretty] ${compact ? 'text-sm line-clamp-1' : 'text-lg sm:text-xl line-clamp-2'}`}>
              {displayTitle}
            </h3>
            <button
              className={`flex items-center gap-1.5 tracking-[0.04em] text-white/85 hover:text-white hover:underline underline-offset-2 transition-colors w-fit max-w-full ${compact ? 'text-[11px]' : 'text-[13px]'}`}
              onClick={handleLocationClick}
              disabled={isGeocoding}
              aria-label="Show on map"
            >
              <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="line-clamp-1">{displayLocation}</span>
              {isGeocoding && <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />}
            </button>
          </div>
        )}

        {/* Current photo's highlight — plain italic caption, no quotes */}
        {quote && (
          <p className={`font-serif italic leading-snug text-white/95 ${compact ? 'text-[13px] line-clamp-1' : 'text-[15px] line-clamp-2'}`}>
            {quote}
          </p>
        )}

        {/* Size · price · contact — one level */}
        <div className={`flex items-center justify-between gap-2 border-t border-white/30 ${compact ? 'pt-1.5' : 'pt-2.5'}`}>
          <span className={`text-white/80 line-clamp-1 ${compact ? 'text-[11px]' : 'text-[13px]'}`}>{spec}</span>
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className={`font-semibold whitespace-nowrap ${compact ? 'text-sm' : 'text-lg'}`}>
              {formatPrice(apartment.price)}
              <span className={`font-normal text-white/80 ${compact ? 'text-[10px]' : 'text-xs'}`}> /mo</span>
            </span>
            {onContact && (
              <Button
                size="sm"
                className="h-8 px-4 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-md"
                onClick={e => {
                  e.stopPropagation();
                  onContact();
                }}
              >
                Contact
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Map modal for the location */}
      {(hasCoords || geocodedCoords) && (
        <MapViewModal
          isOpen={isMapOpen}
          onClose={() => setIsMapOpen(false)}
          latitude={mapLat}
          longitude={mapLng}
          title={apartment.title}
          location={apartment.location}
        />
      )}
    </div>
  );
};
