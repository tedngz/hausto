import { useState, useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight, MapPin, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getNormalizedAmenities } from '@/components/PropertyAmenities';
import { MapViewModal } from '@/components/MapViewModal';
import { useCurrency } from '@/contexts/CurrencyContext';
import { toast } from '@/hooks/use-toast';
import { translateLocationToEnglish } from '@/utils/locationTranslation';
import { normalizeRepeatedTitle } from '@/utils/normalizeTitle';
import { getVibeRatingLabel } from '@/utils/vibeRating';
import { formatSize } from '@/utils/propertySize';
import { geocodeLocation } from '@/utils/geocoding';
import { Apartment } from '@/types';

// Full listing card for the individual property page: a 16:9 gallery on top and
// a details panel below (badges, title/price, vibe tags, description, amenities).
// Portrait photos are letterboxed over a blurred backdrop so nothing is cropped.

const EASE = 'cubic-bezier(0.22,1,0.36,1)';

const RATING_DOT: Record<string, string> = {
  perfect: 'bg-emerald-500',
  strong: 'bg-blue-500',
  good: 'bg-primary',
  casual: 'bg-muted-foreground/50',
};

const verifiedLabel = (iso?: string | null): string | null => {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return null;
  if (days === 0) return 'Verified live today';
  if (days === 1) return 'Verified yesterday';
  return `Verified ${days}d ago`;
};

interface PropertyListingCardProps {
  apartment: Apartment;
  /** 0-100 match score; renders the match badge when provided */
  vibeScore?: { overall: number };
  onContact?: () => void;
}

export const PropertyListingCard = ({ apartment, vibeScore, onContact }: PropertyListingCardProps) => {
  const images = apartment.images && apartment.images.length > 0 ? apartment.images : ['/placeholder-property.jpg'];
  const [current, setCurrent] = useState(0);
  const [fits, setFits] = useState<Record<number, 'cover' | 'contain'>>({});
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [geocodedCoords, setGeocodedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const { formatPrice } = useCurrency();

  // Probe each photo's orientation as it comes into view and remember the fit.
  // Portrait shots (taller than 16:9) are contained over a blurred backdrop.
  useEffect(() => {
    const src = images[current];
    if (!src || fits[current]) return;
    const probe = new Image();
    probe.onload = () => {
      const portrait = probe.naturalHeight / probe.naturalWidth > 9 / 16;
      setFits(f => (f[current] ? f : { ...f, [current]: portrait ? 'contain' : 'cover' }));
    };
    probe.src = src;
  }, [current, images, fits]);

  const fit = fits[current] ?? 'cover';

  const go = (delta: number) => setCurrent(c => (c + delta + images.length) % images.length);

  const displayTitle = useMemo(() => normalizeRepeatedTitle(apartment.title ?? ''), [apartment.title]);
  const displayLocation = useMemo(() => translateLocationToEnglish(apartment.location), [apartment.location]);

  // Per-photo AI highlight for the image currently in view.
  const highlight = useMemo(() => {
    const analyses = apartment.vibe_analysis?.image_analyses;
    if (!Array.isArray(analyses)) return '';
    const match = analyses.find((a: any) => Number(a?.image_index) === current);
    const text = match?.image_highlight || match?.highlight;
    return typeof text === 'string' && text.trim() ? text.trim() : '';
  }, [apartment.vibe_analysis, current]);

  const sizeLine = [apartment.rooms, formatSize(apartment.size)].filter(s => s && String(s).trim()).join(' · ');
  const amenities = getNormalizedAmenities(apartment.amenities, 9);
  const ratingLabel = vibeScore ? getVibeRatingLabel(Number(vibeScore.overall)) : null;
  const verified = verifiedLabel(apartment.last_verified_at);

  // Overall vibe/style for the badge — the analysed styles when available,
  // else the display vibe string ("Modern, Elegant"). Not the per-image
  // highlights, which are full sentences and read poorly as a badge.
  const vibeStyles = useMemo(() => {
    const analysed = apartment.vibe_analysis?.styles;
    const source: unknown[] = Array.isArray(analysed) && analysed.length > 0
      ? analysed
      : String(apartment.vibe ?? '').split(',');
    return source
      .map(s => String(s).replace(/_/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 3);
  }, [apartment.vibe_analysis, apartment.vibe]);

  const description = useMemo(() => {
    const desc = apartment.description?.trim();
    if (!desc) return '';
    return desc.toLowerCase() === displayTitle.trim().toLowerCase() ? '' : desc;
  }, [apartment.description, displayTitle]);

  const hasCoords = !!(apartment.latitude && apartment.longitude);
  const mapLat = hasCoords ? apartment.latitude! : geocodedCoords?.lat ?? 0;
  const mapLng = hasCoords ? apartment.longitude! : geocodedCoords?.lng ?? 0;

  const handleLocationClick = async () => {
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
    <article className="w-full overflow-hidden rounded-[22px] bg-card text-foreground border border-border/60 shadow-[0_28px_70px_-30px_rgba(0,0,0,0.45)]">
      {/* ===== Gallery — 3:2 so the photo carries the page ===== */}
      <div className="relative w-full aspect-[4/3] sm:aspect-[3/2] overflow-hidden bg-foreground">
        {/* Blurred fill behind letterboxed portrait photos */}
        <img
          src={images[current]}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover object-center scale-110"
          style={{ filter: 'blur(28px) brightness(0.7)', opacity: fit === 'contain' ? 1 : 0, transition: 'opacity 300ms ease' }}
        />
        <img
          src={images[current]}
          alt={`${displayTitle} — photo ${current + 1} of ${images.length}`}
          className="absolute inset-0 w-full h-full"
          style={{ objectFit: fit, objectPosition: 'center', transition: `object-position 900ms ${EASE}` }}
          onError={e => {
            const target = e.target as HTMLImageElement;
            target.onerror = null;
            target.src = '/placeholder-property.jpg';
          }}
        />

        {/* Scrim for legibility */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'linear-gradient(180deg, rgba(20,16,11,0.55) 0%, rgba(20,16,11,0) 26%, rgba(20,16,11,0) 44%, rgba(20,16,11,0.82) 100%)' }}
        />

        {/* Progress bars */}
        {images.length > 1 && (
          <div className="absolute top-4 left-5 right-5 flex gap-1.5">
            {images.map((_, i) => (
              <div key={i} className="flex-1 h-[3px] rounded-full bg-white/35 overflow-hidden">
                <div
                  className="h-full rounded-full bg-white"
                  style={{ width: i === current ? '100%' : '0%', transition: 'width 400ms ease' }}
                />
              </div>
            ))}
          </div>
        )}

        {/* Arrows */}
        {images.length > 1 && (
          <>
            <button
              aria-label="Previous photo"
              onClick={() => go(-1)}
              className="absolute top-1/2 left-3.5 -translate-y-1/2 w-[34px] h-[34px] rounded-full bg-black/40 text-white backdrop-blur-md flex items-center justify-center hover:bg-black/60 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              aria-label="Next photo"
              onClick={() => go(1)}
              className="absolute top-1/2 right-3.5 -translate-y-1/2 w-[34px] h-[34px] rounded-full bg-black/40 text-white backdrop-blur-md flex items-center justify-center hover:bg-black/60 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </>
        )}

        {/* Per-photo highlight caption */}
        {highlight && (
          <p
            className="absolute left-6 right-6 bottom-4 font-serif italic text-white/95 text-[15px] sm:text-base leading-snug [text-wrap:pretty]"
            style={{ transition: 'opacity 300ms ease' }}
          >
            {highlight}
          </p>
        )}
      </div>

      {/* ===== Details ===== */}
      <div className="flex flex-col gap-4 sm:gap-[18px] p-5 sm:px-6 sm:pt-[22px] sm:pb-6">
        {/* Badges */}
        {(ratingLabel || vibeStyles.length > 0 || verified) && (
          <div className="flex flex-wrap gap-2">
            {/* Signed-in renters with preferences see how well it matches them;
                everyone else sees the property's own analysed style. */}
            {ratingLabel ? (
              <span className="flex items-center gap-[7px] rounded-full bg-secondary text-secondary-foreground px-3 py-1.5 font-mono text-[10.5px] tracking-[0.12em] uppercase">
                <span className={`w-1.5 h-1.5 rounded-full ${RATING_DOT[ratingLabel] || 'bg-muted-foreground/50'}`} />
                {ratingLabel} match
              </span>
            ) : vibeStyles.length > 0 ? (
              <span className="flex items-center gap-[7px] rounded-full bg-secondary text-secondary-foreground px-3 py-1.5 font-mono text-[10.5px] tracking-[0.12em] uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                {vibeStyles.join(' · ')}
              </span>
            ) : null}
            {verified && (
              <span className="flex items-center gap-[7px] rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-3 py-1.5 text-[11.5px]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {verified}
              </span>
            )}
          </div>
        )}

        {/* Title + location (left) · price + size (right), generously spaced so
            a long title never crowds the price */}
        <div className="flex items-start justify-between gap-6 sm:gap-10">
          <div className="flex flex-col gap-2 min-w-0">
            <h2 className="font-serif font-medium text-2xl sm:text-[32px] leading-[1.06] [text-wrap:pretty]">
              {displayTitle}
            </h2>
            <button
              className="flex items-center gap-[7px] text-[13px] text-muted-foreground hover:text-foreground transition-colors w-fit max-w-full text-left"
              onClick={handleLocationClick}
              disabled={isGeocoding}
              aria-label="Show on map"
            >
              <MapPin className="w-3.5 h-3.5 text-primary flex-shrink-0" />
              <span className="underline decoration-border underline-offset-4 hover:decoration-foreground line-clamp-2">
                {displayLocation}
              </span>
              {isGeocoding && <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />}
            </button>
          </div>

          <div className="flex flex-col items-end gap-1.5 flex-shrink-0 text-right">
            <p className="font-serif font-semibold text-xl sm:text-[28px] leading-tight whitespace-nowrap">
              {formatPrice(apartment.price)}
              <span className="font-sans font-normal text-[13px] text-muted-foreground"> /mo</span>
            </p>
            {sizeLine && <p className="text-[12.5px] text-muted-foreground whitespace-nowrap">{sizeLine}</p>}
          </div>
        </div>

        {/* Description */}
        {description && (
          <p className="border-t border-border pt-[18px] text-[13.5px] leading-[1.6] text-muted-foreground [text-wrap:pretty]">
            {description}
          </p>
        )}

        {/* Amenities */}
        {amenities.length > 0 && (
          <div>
            <p className="font-mono text-[10.5px] tracking-[0.14em] uppercase text-muted-foreground mb-3">What's inside</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-2.5 gap-y-3">
              {amenities.map(({ key, label, icon: Icon }) => (
                <div key={key} className="flex items-center gap-2.5 text-[12.5px] text-foreground/85">
                  {Icon ? (
                    <Icon className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                  ) : (
                    <span className="w-[7px] h-[7px] rounded-[2px] bg-primary flex-shrink-0" />
                  )}
                  <span className="line-clamp-1">{label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {onContact && (
          <Button className="w-full rounded-full mt-1" size="lg" onClick={onContact}>
            Contact
          </Button>
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
    </article>
  );
};
