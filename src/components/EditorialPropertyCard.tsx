import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Heart, MapPin, Loader2, Check, X, Share2, LayoutGrid } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VibeMatchPopover, type VibeScoreDetails, type VibeMatchAttributes } from '@/components/VibeMatchPopover';
import { PropertyAmenities } from '@/components/PropertyAmenities';
import { MapViewModal } from '@/components/MapViewModal';
import { useCurrency } from '@/contexts/CurrencyContext';
import { toast } from '@/hooks/use-toast';
import { translateLocationToEnglish } from '@/utils/locationTranslation';
import { normalizeRepeatedTitle } from '@/utils/normalizeTitle';
import { getVibeRatingLabel } from '@/utils/vibeRating';
import { formatSize } from '@/utils/propertySize';
import { shareProperty } from '@/utils/shareProperty';
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
  amenities?: string[];
  vibe_analysis?: any;
  latitude?: number | null;
  longitude?: number | null;
  last_verified_at?: string | null;
}

// The vibe badge's popover lives in VibeMatchPopover so every surface shows the
// same breakdown; these re-exports keep existing import sites working.
export type { VibeScoreDetails, VibeMatchAttributes };

interface EditorialPropertyCardProps {
  apartment: EditorialApartment;
  /** 0-100 match score; rendered as a rating chip (casual/good/strong/perfect) with a details popover */
  vibeScore?: VibeScoreDetails;
  /** Detected style/color/lifestyle attributes with match flags — shown in the vibe popover */
  vibeMatch?: VibeMatchAttributes;
  /** Prose shown in the scoring popover when no attributes exist (e.g. the AI match reason) */
  vibeDetailsText?: string;
  /** What the score measures: fit to the current AI search ('search') or to the
   *  renter's saved preferences ('preferences', default). Changes the popover
   *  title/explanation so renters understand why the two ratings can differ. */
  scoreContext?: 'search' | 'preferences';
  /** Quote shown when the current image has no per-image highlight */
  quoteFallback?: string;
  onCardClick?: () => void;
  /** When set (card shown in an overlay), renders a close button inline with
   *  share/like at the same size and style, instead of a floating dialog X. */
  onClose?: () => void;
  liked?: boolean;
  onLike?: () => void;
  onContact?: () => void;
  /** Label for the onContact button (default "Contact") */
  contactLabel?: string;
  /** Primary "Schedule viewing" CTA — when set, onContact renders as a secondary button */
  onSchedule?: () => void;
  /** Label for the onSchedule button (default "Viewing") */
  scheduleLabel?: string;
  initialImageIndex?: number;
  onImageIndexChange?: (index: number) => void;
  /** Override the card's aspect ratio (default: editorial 380/560 portrait) */
  aspectClass?: string;
  /** Smaller typography so the photo dominates (used in the AI chat's compact cards) */
  compact?: boolean;
  /** Extra actions rendered in the top-right cluster, before the share/like buttons (e.g. a delete button) */
  topRightActions?: ReactNode;
  className?: string;
}

const EASE = 'cubic-bezier(0.22,1,0.36,1)';

// A photo may be stretched this much to fill the frame before it starts to
// look soft; past it, show it at its own size over a blurred backdrop.
const MAX_UPSCALE = 1.2;
// How much of a photo may be cropped away to fill the frame before we
// letterbox it instead. The frame is responsive (portrait on mobile, 4:3 from
// sm up), so this is measured against the frame actually on screen.
const MAX_CROP = 0.2;

const RATING_DOT: Record<string, string> = {
  perfect: 'bg-emerald-400',
  strong: 'bg-blue-400',
  good: 'bg-orange-400',
  casual: 'bg-gray-300',
};

export const EditorialPropertyCard = ({
  apartment,
  vibeScore,
  vibeMatch,
  vibeDetailsText,
  scoreContext = 'preferences',
  quoteFallback,
  onCardClick,
  onClose,
  liked,
  onLike,
  onContact,
  contactLabel = 'Contact',
  onSchedule,
  scheduleLabel = 'Viewing',
  initialImageIndex = 0,
  onImageIndexChange,
  aspectClass = 'aspect-[380/560]',
  compact = false,
  topRightActions,
  className = '',
}: EditorialPropertyCardProps) => {
  const images = apartment.images && apartment.images.length > 0 ? apartment.images : ['/placeholder-property.jpg'];
  const [current, setCurrent] = useState(Math.min(initialImageIndex, images.length - 1));
  const [fits, setFits] = useState<Record<number, 'cover' | 'contain'>>({});
  const frameRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const [noHover, setNoHover] = useState(false);
  const [tapReveal, setTapReveal] = useState(false);
  const [showAmenities, setShowAmenities] = useState(false);
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

  // Probe each photo as it comes into view and decide how it should sit in the
  // frame. Two cases get letterboxed at their own size over a blurred copy of
  // themselves rather than filling the card:
  //   - shots whose shape differs enough from the frame that "cover" would
  //     crop a fifth of them away (portrait photos in the 4:3 frame, mostly)
  //   - small sources (some listings still carry 140x140 crop thumbs), which
  //     "cover" would blow up several times over into a blurry mess
  // Everything else keeps the full-bleed look. Measured against the frame on
  // screen, since it is portrait on mobile and 4:3 from sm up.
  useEffect(() => {
    const src = images[current];
    if (!src || fits[current]) return;
    const probe = new Image();
    probe.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = probe;
      if (!w || !h) return;
      const rect = frameRef.current?.getBoundingClientRect();
      const fw = rect?.width || 380;
      const fh = rect?.height || 560;
      const coverScale = Math.max(fw / w, fh / h);
      // Fraction of the photo that "cover" would push outside the frame
      const cropped = 1 - (fw * fh) / (w * coverScale * h * coverScale);
      const letterbox = cropped > MAX_CROP || coverScale > MAX_UPSCALE;
      setFits(f => (f[current] ? f : { ...f, [current]: letterbox ? 'contain' : 'cover' }));
    };
    probe.src = src;
  }, [current, images, fits]);

  // The frame flips between portrait and 4:3 at the sm breakpoint, so a photo
  // that fits one may not fit the other - re-measure when the card resizes.
  useEffect(() => {
    const el = frameRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let last = el.getBoundingClientRect().width;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width ?? last;
      if (Math.abs(w - last) < 24) return;   // ignore scrollbar-level jitter
      last = w;
      setFits({});
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = fits[current] ?? 'cover';

  const go = (delta: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setTapReveal(false);
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
  // Some sources repeat the room count in the size field — show it once.
  const spec = [apartment.rooms, formatSize(apartment.size)]
    .map(s => String(s ?? '').trim())
    .filter((s, i, all) => s && all.indexOf(s) === i)
    .join(' · ');
  // Freshness chip: how recently the source listing was confirmed still live.
  // Claims "live on source", never "available" — availability is only settled at viewing time.
  const verifiedLabel = useMemo(() => {
    if (!apartment.last_verified_at) return '';
    const days = Math.floor((Date.now() - new Date(apartment.last_verified_at).getTime()) / 86_400_000);
    if (days < 0 || days > 30) return '';
    if (days === 0) return 'Verified live today';
    return `Verified live ${days}d ago`;
  }, [apartment.last_verified_at]);
  const arrowsVisible = hover || noHover;
  // Desktop reveals the description on hover; touch devices (no hover) reveal it
  // on tap of the cover image instead of showing it permanently.
  const revealVisible = noHover ? tapReveal : hover;
  const isFirstImage = current === 0;

  // Full description, revealed on hover (touch devices have no hover, so it stays open).
  // Skip it when it merely repeats the title or the visible caption.
  const revealText = useMemo(() => {
    const desc = apartment.description?.trim();
    if (!desc) return '';
    const lower = desc.toLowerCase();
    if (lower === displayTitle.trim().toLowerCase()) return '';
    if (quote && lower === quote.trim().toLowerCase()) return '';
    return desc;
  }, [apartment.description, displayTitle, quote]);

  const amenities = Array.isArray(apartment.amenities) ? apartment.amenities.filter(a => a && String(a).trim()) : [];
  const hasAmenities = amenities.length > 0;

  const ratingLabel = vibeScore ? getVibeRatingLabel(Number(vibeScore.overall)) : null;

  const hasCoords = !!(apartment.latitude && apartment.longitude);
  const mapLat = hasCoords ? apartment.latitude! : geocodedCoords?.lat ?? 0;
  const mapLng = hasCoords ? apartment.longitude! : geocodedCoords?.lng ?? 0;

  const handleShare = (e: React.MouseEvent) => {
    e.stopPropagation();
    shareProperty(apartment.id, displayTitle, { openPage: true });
  };

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
      ref={frameRef}
      className={`group relative w-full ${aspectClass} overflow-hidden rounded-[20px] bg-foreground shadow-[0_8px_24px_-12px_rgba(0,0,0,0.25)] select-none ${onCardClick ? 'cursor-pointer' : ''} ${className}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onCardClick}
      role={onCardClick ? 'button' : undefined}
    >
      {/* Blurred fill behind letterboxed portrait photos */}
      <img loading="lazy"
        src={images[current]}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 w-full h-full object-cover object-center scale-110"
        style={{ filter: 'blur(28px) brightness(0.7)', opacity: fit === 'contain' ? 1 : 0, transition: 'opacity 300ms ease' }}
      />

      {/* Slideshow image */}
      <img loading="lazy"
        src={images[current]}
        alt={`${displayTitle} — photo ${current + 1} of ${images.length}`}
        className="absolute inset-0 w-full h-full"
        style={{
          objectFit: fit,
          objectPosition: 'center',
          transition: `transform 1200ms ${EASE}`,
          // Zooming a letterboxed photo would crop it again - only cover zooms.
          transform: hover && fit === 'cover' ? 'scale(1.07)' : 'scale(1)',
        }}
        onClick={e => {
          // On touch devices, tap the cover photo to reveal/hide the description
          // instead of showing it permanently. Let other taps fall through to onCardClick.
          if (noHover && isFirstImage && revealText) {
            e.stopPropagation();
            setTapReveal(v => !v);
          }
        }}
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

      {/* Top row: vibe match rating chip + verified chip (left), share/like (right) */}
      <div className="absolute top-5 left-5 right-5 flex items-start justify-between">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
        {ratingLabel ? (
          <VibeMatchPopover
            vibeScore={vibeScore}
            vibeMatch={vibeMatch}
            vibeDetailsText={vibeDetailsText}
            scoreContext={scoreContext}
          >
            <button
              aria-label="View match scoring details"
              className="flex items-center gap-1.5 rounded-full bg-black/35 backdrop-blur-md px-3 py-1.5 text-white hover:bg-black/55 transition-colors"
              onClick={e => e.stopPropagation()}
            >
              <span className={`w-2 h-2 rounded-full ${RATING_DOT[ratingLabel] || 'bg-gray-300'}`} />
              <span className="font-mono text-[11px] tracking-[0.14em] uppercase">{ratingLabel} match</span>
            </button>
          </VibeMatchPopover>
        ) : null}
        {verifiedLabel && (
          <span className={`flex items-center gap-1.5 rounded-full bg-black/35 backdrop-blur-md text-white/90 whitespace-nowrap ${compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]'}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            {verifiedLabel}
          </span>
        )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {topRightActions}
          <Button
            size="icon"
            variant="secondary"
            aria-label="Share property"
            className="w-8 h-8 rounded-full border-0 backdrop-blur-md transition-all bg-white/20 text-white hover:bg-white/40"
            onClick={handleShare}
          >
            <Share2 className="w-4 h-4" />
          </Button>
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
          {onClose && (
            <Button
              size="icon"
              variant="secondary"
              aria-label="Close"
              className="w-8 h-8 rounded-full border-0 backdrop-blur-md transition-all bg-white/20 text-white hover:bg-white/40"
              onClick={e => {
                e.stopPropagation();
                onClose();
              }}
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
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

        {/* Full description — cover (first image) only; hidden at rest, slides up on hover (always open on touch) */}
        {isFirstImage && revealText && (
          <div
            className="overflow-hidden"
            style={{
              maxHeight: revealVisible ? (compact ? 84 : 120) : 0,
              opacity: revealVisible ? 1 : 0,
              transition: `max-height 700ms ${EASE}, opacity 500ms ${EASE}`,
            }}
          >
            <p className={`text-white/85 leading-relaxed ${compact ? 'text-[11px] line-clamp-4' : 'text-[13px] line-clamp-5'}`}>
              {revealText}
            </p>
          </div>
        )}

        {/* Size · amenities · price · contact — one level */}
        {/* Wraps rather than squeezing: at phone widths a price plus two CTAs
            (contact + schedule) doesn't fit on one line. */}
        <div className={`flex flex-wrap items-center justify-between gap-x-2 gap-y-2 border-t border-white/30 ${compact ? 'pt-1.5' : 'pt-2.5'}`}>
          <div className="flex items-center gap-2 min-w-0">
            <span className={`text-white/80 line-clamp-1 ${compact ? 'text-[11px]' : 'text-[13px]'}`}>{spec}</span>
            {hasAmenities && (
              <button
                type="button"
                aria-label={showAmenities ? 'Hide amenities' : 'Show amenities'}
                aria-expanded={showAmenities}
                title="Amenities"
                className={`flex-shrink-0 flex items-center justify-center rounded-full backdrop-blur-md transition-colors ${compact ? 'w-5 h-5' : 'w-6 h-6'} ${showAmenities ? 'bg-white text-foreground' : 'bg-black/35 text-white hover:bg-black/55'}`}
                onClick={e => {
                  e.stopPropagation();
                  setShowAmenities(v => !v);
                }}
              >
                <LayoutGrid className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className={`font-semibold whitespace-nowrap ${compact ? 'text-sm' : 'text-lg'}`}>
              {formatPrice(apartment.price)}
              <span className={`font-normal text-white/80 ${compact ? 'text-[10px]' : 'text-xs'}`}> /mo</span>
            </span>
            {onContact && (
              <Button
                size="sm"
                variant={onSchedule ? 'outline' : 'default'}
                className={`h-8 rounded-full shadow-md ${onSchedule
                  ? 'px-3 bg-white/15 hover:bg-white/30 text-white border-white/40'
                  : 'px-4 bg-primary hover:bg-primary/90 text-primary-foreground'}`}
                onClick={e => {
                  e.stopPropagation();
                  onContact();
                }}
              >
                {contactLabel}
              </Button>
            )}
            {onSchedule && (
              <Button
                size="sm"
                className="h-8 px-3 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-md"
                onClick={e => {
                  e.stopPropagation();
                  onSchedule();
                }}
              >
                {scheduleLabel}
              </Button>
            )}
          </div>
        </div>

        {/* Amenity details — revealed when the amenities icon next to the spec is toggled */}
        {hasAmenities && showAmenities && (
          <div className="w-full">
            <PropertyAmenities amenities={amenities} compact variant="overlay" />
          </div>
        )}
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
