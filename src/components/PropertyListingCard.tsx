import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, MapPin, Loader2, Sparkles, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getNormalizedAmenities } from '@/lib/amenities';
import { MapViewModal } from '@/components/MapViewModal';
import { VibeMatchPopover, type VibeMatchAttributes, type VibeScoreDetails } from '@/components/VibeMatchPopover';
import { useCurrency } from '@/contexts/CurrencyContext';
import { toast } from '@/hooks/use-toast';
import { translateLocationToEnglish } from '@/utils/locationTranslation';
import { normalizeRepeatedTitle } from '@/utils/normalizeTitle';
import { getVibeRatingLabel } from '@/utils/vibeRating';
import { formatSize } from '@/utils/propertySize';
import { geocodeLocation } from '@/utils/geocoding';
import { extractPropertyFeatures, propertyHasFeature, FEATURE_LABELS, type FeatureKey } from '@/lib/propertyFeatures';
import { Apartment, UserPreferences } from '@/types';
import { ASSISTANT_OPEN_EVENT, type AssistantOpenDetail } from '@/lib/assistantEvents';
import { requestPass } from '@/lib/passEvents';
import { openDeepScan } from '@/lib/deepScanEvents';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DeepVibeAnalysis } from '@/components/DeepVibeAnalysis';
import { RequestViewingModal } from '@/components/RequestViewingModal';

// Full listing card for the individual property page: a 16:9 gallery on top and
// a details panel below (badges, title/price, vibe tags, description, amenities).
// Portrait photos are letterboxed over a blurred backdrop so nothing is cropped.

const EASE = 'cubic-bezier(0.22,1,0.36,1)';

// One array for every card with no photos. Built inline, it was a new array
// each render, which re-ran the photo-fit probe on every render.
const PLACEHOLDER_IMAGES = ['/placeholder-property.jpg'];

const RATING_DOT: Record<string, string> = {
  perfect: 'bg-emerald-500',
  strong: 'bg-blue-500',
  good: 'bg-primary',
  casual: 'bg-muted-foreground/50',
};


interface PropertyListingCardProps {
  apartment: Apartment;
  /** 0-100 match score; renders the match badge when provided */
  vibeScore?: VibeScoreDetails;
  /** Renter preferences — used to flag matching attributes in the vibe popover */
  preferences?: UserPreferences | null;
  /** Matched style/lifestyle/feature attributes shown in the vibe popover */
  vibeMatch?: VibeMatchAttributes;
  /** Retained so existing call sites keep compiling; the card now opens the
   *  request modal itself rather than asking its parent to. Unused. */
  onBookViewing?: () => void;
  /** Disables the CTA while the booking flow is being opened */
  isBooking?: boolean;
  /** Offers the viewing shortlist. Crawled listings only - the viewing flow
   *  requests against `external_properties`, and an internal listing has its
   *  own booking path. */
  shortlistable?: boolean;
  /** Rendered directly under "Request viewing" - the choice beside it
   *  (AgentContact). Only with the button. */
  requestFooter?: ReactNode;
}

export const PropertyListingCard = ({
  apartment,
  vibeScore,
  preferences,
  vibeMatch,
  onBookViewing,
  isBooking = false,
  shortlistable = false,
  requestFooter,
}: PropertyListingCardProps) => {
  const images = apartment.images && apartment.images.length > 0 ? apartment.images : PLACEHOLDER_IMAGES;
  const [current, setCurrent] = useState(0);
  const [requestOpen, setRequestOpen] = useState(false);
  // Controlled so pressing the Deep Scan CTA can close it: the scan is read
  // in the chat, and a popover left open sits over the card it is about.
  const [scanOpen, setScanOpen] = useState(false);
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

  // Same affordance the property cards carry, so asking about a listing works
  // the same whether you met it in a list or on its own page.
  const askAssistant = () => {
    const detail: AssistantOpenDetail = { propertyId: apartment.id, title: displayTitle };
    window.dispatchEvent(new CustomEvent(ASSISTANT_OPEN_EVENT, { detail }));
  };

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

  // Some sources put the room count in the size field too, which rendered as
  // "3 Bedrooms · 3 Bedrooms" — drop the duplicate rather than show it twice.
  const sizeLine = [apartment.rooms, formatSize(apartment.size)]
    .map(s => String(s ?? '').trim())
    .filter((s, i, all) => s && all.indexOf(s) === i)
    .join(' · ');
  const amenities = getNormalizedAmenities(apartment.amenities, 9);
  const ratingLabel = vibeScore ? getVibeRatingLabel(Number(vibeScore.overall)) : null;

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

  // Signed-out visitors have nothing to match against, so the popover shows what
  // the AI read from the listing — style, what it's good for, and the concrete
  // features — with no match flags.
  const analysedVibe = useMemo<VibeMatchAttributes | undefined>(() => {
    const va: any = apartment.vibe_analysis;
    const style = vibeStyles.map(label => ({ label, matched: false }));

    const lifestyle = (Array.isArray(va?.activities) ? va.activities : [])
      .map((a: unknown) => String(a).replace(/_/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 6)
      .map((label: string) => ({ label, matched: false }));

    const featureSource =
      va?.features && typeof va.features === 'object'
        ? va.features
        : extractPropertyFeatures({
            metrics: va,
            amenities: apartment.amenities,
            highlights: apartment.highlights,
            description: apartment.description,
            title: apartment.title,
          });
    const features = (Object.keys(FEATURE_LABELS) as FeatureKey[])
      .filter(k => propertyHasFeature(featureSource, k))
      .map(k => ({ label: FEATURE_LABELS[k], matched: false }));

    if (style.length + lifestyle.length + features.length === 0) return undefined;
    return { style, lifestyle, features };
  }, [apartment, vibeStyles]);

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
    <article className="w-full overflow-hidden rounded-[22px] bg-card text-foreground border border-border/60">
      {/* ===== Gallery — 3:2 so the photo carries the page ===== */}
      <div className="relative w-full aspect-[4/3] sm:aspect-[3/2] overflow-hidden bg-foreground">
        {/* Blurred fill behind letterboxed portrait photos */}
        <img loading="lazy"
          src={images[current]}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover object-center scale-110"
          style={{ filter: 'blur(28px) brightness(0.7)', opacity: fit === 'contain' ? 1 : 0, transition: 'opacity 300ms ease' }}
        />
        <img loading="lazy"
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

        {/* Ask the assistant about this listing */}
        <button
          type="button"
          aria-label="Ask Hausto Agent about this property"
          title="Ask the Hausto Assistant about this property"
          onClick={askAssistant}
          className="absolute top-8 right-5 w-8 h-8 rounded-full bg-primary/85 text-primary-foreground backdrop-blur-md flex items-center justify-center hover:bg-primary transition-colors"
        >
          <Sparkles className="w-4 h-4" />
        </button>

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
        <div className="flex flex-wrap gap-2">
          {/* Signed-in renters with preferences see how well it matches them;
              everyone else sees the property's own analysed style. Either way
              the badge opens the full vibe breakdown. */}
          {(ratingLabel || vibeStyles.length > 0) && (
            <VibeMatchPopover
              vibeScore={vibeScore}
              vibeMatch={vibeMatch ?? analysedVibe}
              note={vibeScore ? undefined : 'Sign in and set your preferences to see how well this place matches you.'}
            >
              <button
                type="button"
                aria-label="View match scoring details"
                className="flex items-center gap-[7px] rounded-full bg-secondary text-secondary-foreground px-3 py-1.5 font-mono text-[10.5px] tracking-[0.12em] uppercase hover:bg-secondary/70 transition-colors"
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    ratingLabel ? RATING_DOT[ratingLabel] || 'bg-muted-foreground/50' : 'bg-primary'
                  }`}
                />
                {ratingLabel ? `${ratingLabel} match` : vibeStyles.join(' · ')}
              </button>
            </VibeMatchPopover>
          )}
          {/* Same chip the shelf cards carry, opening the same scan, so a
              listing reads and behaves the same on the page as it did in the
              list it was found in. This page only ever shows Hausto listings,
              so the scan is always read from the internal ledger. */}
          <Popover open={scanOpen} onOpenChange={setScanOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Open the Deep Scan for this listing"
                className="flex items-center gap-[5px] rounded-full bg-primary/10 text-primary px-3 py-1.5 text-[11.5px] whitespace-nowrap transition-colors hover:bg-primary/20"
              >
                <Search className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
                Deep Scan
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-[calc(100vw-2rem)] max-w-sm p-4"
              collisionPadding={12}
            >
              <DeepVibeAnalysis
                bare
                ctaOnly
                propertyId={apartment.id}
                title={displayTitle}
                onRequestPass={() => {
                  setScanOpen(false);
                  requestPass();
                }}
                onScan={() => {
                  setScanOpen(false);
                  openDeepScan({
                    propertyId: apartment.id,
                    title: displayTitle,
                    propertyType: 'internal',
                  });
                }}
              />
            </PopoverContent>
          </Popover>
          </div>

        {/* Title + location (left) · price + size (right), generously spaced so
            a long title never crowds the price */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-10">
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

          {/* Mobile: a full-width row under the title — price left, spec right —
              so neither floats away from the text. Desktop: right-hand column. */}
          <div className="flex items-baseline justify-between gap-3 sm:flex-col sm:items-end sm:justify-start sm:gap-1.5 sm:flex-shrink-0 sm:text-right">
            <p className="font-serif font-semibold text-xl sm:text-[28px] leading-tight whitespace-nowrap">
              {formatPrice(apartment.price)}
              <span className="font-sans font-normal text-[13px] text-muted-foreground"> /mo</span>
            </p>
            {sizeLine && <p className="text-[12.5px] text-muted-foreground text-right">{sizeLine}</p>}
          </div>
        </div>

        {/* Description */}
        {description && (
          <p className="border-t border-border pt-[18px] text-[13.5px] leading-[1.6] text-muted-foreground text-justify hyphens-auto [text-wrap:pretty]">
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

        {/* One button. "Shortlist" and "Book viewing" used to sit here
            together, which asked the renter to care about a distinction that
            was ours: one built a list, the other opened a scheduler, and both
            ended in someone visiting a flat. */}
        {shortlistable && (
          <>
            <Button
              className="w-full rounded-full mt-1"
              size="lg"
              onClick={e => { e.preventDefault(); e.stopPropagation(); setRequestOpen(true); }}
              disabled={isBooking}
            >
              {isBooking ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Request viewing'}
            </Button>
            {requestFooter}
            <RequestViewingModal
              open={requestOpen}
              onOpenChange={setRequestOpen}
              seed={{
                listingId: apartment.id,
                title: apartment.title,
                imageUrl: apartment.images?.[0] ?? null,
              }}
            />
          </>
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
