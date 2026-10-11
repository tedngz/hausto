import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Heart, MapPin, Loader2, X, Share2, LayoutGrid, Sparkles, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VibeMatchPopover, type VibeScoreDetails, type VibeMatchAttributes } from '@/components/VibeMatchPopover';
import { getNormalizedAmenities } from '@/lib/amenities';
import { MapViewModal } from '@/components/MapViewModal';
import { useCurrency } from '@/contexts/CurrencyContext';
import { toast } from '@/hooks/use-toast';
import { translateLocationToEnglish } from '@/utils/locationTranslation';
import { normalizeRepeatedTitle } from '@/utils/normalizeTitle';
import { getVibeRatingLabel } from '@/utils/vibeRating';
import { formatSize } from '@/utils/propertySize';
import { shareProperty } from '@/utils/shareProperty';
import { geocodeLocation } from '@/utils/geocoding';
import { extractPropertyFeatures, propertyHasFeature, FEATURE_LABELS, type FeatureKey } from '@/lib/propertyFeatures';
import { ASSISTANT_OPEN_EVENT, type AssistantOpenDetail } from '@/lib/assistantEvents';
import { requestPass } from '@/lib/passEvents';
import { openDeepScan } from '@/lib/deepScanEvents';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DeepVibeAnalysis } from '@/components/DeepVibeAnalysis';
import type { PropertyType } from '@/hooks/useDeepAnalysis';
import { RequestViewingModal } from '@/components/RequestViewingModal';

// The property card used everywhere a listing appears in a list: browse, swipe,
// matches, Hausto Agent, complex pages. Same anatomy as the listing page's card
// (PropertyListingCard) — photo gallery on top, details panel below — so a
// listing reads identically wherever a renter meets it.
//
// Where it differs from the page: on a shelf of listings a card can't spend the
// vertical space, so the description is clamped to one line behind a "more"
// toggle and the amenities live behind their own icon rather than an always-open
// grid. The preview that opens a single listing over browse passes `detail`,
// which lays the details out as the page does - title beside price, the full
// description, "What's inside" - so opening a listing and visiting its page
// show the same card.

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
  /** Which ledger the listing lives in. The scan is stored per listing and the
   *  two id spaces can collide, so a wrong value would show one listing's scan
   *  on another - surfaces carrying crawled listings must pass 'external'. */
  propertyType?: PropertyType;
  /** Whether this card offers the viewing shortlist. Defaults to true for
   *  crawled listings, which are the only ones the viewing flow can request
   *  against - an internal listing has its own booking path. Surfaces that
   *  render a listing for inspection rather than for a renter to act on (a
   *  realtor's preview of their own crawl, an upload preview) pass false. */
  shortlistable?: boolean;
  /** Caption shown when the current image has no per-image highlight */
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
  /** Override the gallery's aspect ratio (the details panel below it flows to its own height) */
  aspectClass?: string;
  /** Smaller typography and padding so the photo dominates (used in the Hausto Agent's compact cards) */
  compact?: boolean;
  /** The listing page's layout (PropertyListingCard) rather than a shelf
   *  card's: title beside price, the description and amenities always open,
   *  the page's type sizes. For a surface showing one listing on its own, where
   *  the renter is reading one place rather than scanning a shelf of them. */
  detail?: boolean;
  /** Extra actions rendered in the top-right cluster, before the share/like buttons (e.g. a delete button) */
  topRightActions?: ReactNode;
  /** Rendered inside the card, under the CTAs, behind a rule. For anything that
   *  belongs to this listing but is not part of the listing - the booking offer
   *  under the preview's CTA. Kept inside the card rather than stacked beneath
   *  it so a renter reads one surface, not a card with a note taped under it. */
  footer?: ReactNode;
  className?: string;
}

const EASE = 'cubic-bezier(0.22,1,0.36,1)';

// A photo may be stretched this much to fill the frame before it starts to
// look soft; past it, show it at its own size over a blurred backdrop.
const MAX_UPSCALE = 1.2;
// How much of a photo may be cropped away to fill the frame before we
// letterbox it instead. The frame is responsive, so this is measured against
// the frame actually on screen.
const MAX_CROP = 0.2;

// One array for every card with no photos. Built inline, it was a new array
// each render, which re-ran the photo-fit probe on every render.
const PLACEHOLDER_IMAGES = ['/placeholder-property.jpg'];

const RATING_DOT: Record<string, string> = {
  perfect: 'bg-emerald-500',
  strong: 'bg-blue-500',
  good: 'bg-primary',
  casual: 'bg-muted-foreground/50',
};

export const EditorialPropertyCard = ({
  apartment,
  vibeScore,
  vibeMatch,
  vibeDetailsText,
  scoreContext = 'preferences',
  propertyType = 'internal',
  shortlistable,
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
  aspectClass = 'aspect-[4/3] sm:aspect-[3/2]',
  compact = false,
  detail = false,
  topRightActions,
  footer,
  className = '',
}: EditorialPropertyCardProps) => {
  // Crawled listings only, unless a surface opts out. The viewing flow requests
  // against `external_properties`; offering this on an internal listing would
  // build a shortlist the intake function rejects.
  const showShortlist = shortlistable ?? propertyType === 'external';
  const images = apartment.images && apartment.images.length > 0 ? apartment.images : PLACEHOLDER_IMAGES;
  const [current, setCurrent] = useState(Math.min(initialImageIndex, images.length - 1));
  const [fits, setFits] = useState<Record<number, 'cover' | 'contain'>>({});
  const frameRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const [noHover, setNoHover] = useState(false);
  const [descOpen, setDescOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [showAmenities, setShowAmenities] = useState(false);
  // Swipe bookkeeping: start point, and a flag so the tap that ends a swipe
  // doesn't also open the card.
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const swipedRef = useRef(false);
  const [isMapOpen, setIsMapOpen] = useState(false);
  // Controlled so pressing the Deep scan CTA can close it: the scan is read
  // in the chat, and a popover left open sits over the card it is about.
  const [scanOpen, setScanOpen] = useState(false);
  const [geocodedCoords, setGeocodedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const { formatPrice } = useCurrency();
  const ctaCount = [showShortlist, !!onContact, !!onSchedule && !showShortlist].filter(Boolean).length;
  const loneCta = ctaCount === 1 && !compact;
  const ctaClass = loneCta ? 'w-full sm:w-auto sm:min-w-64 sm:px-12 rounded-full' : 'flex-1 rounded-full';
  const ctaSize = compact ? 'sm' : detail ? 'lg' : 'default';

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
  // themselves rather than filling the gallery:
  //   - shots whose shape differs enough from the frame that "cover" would
  //     crop a fifth of them away (portrait photos, mostly)
  //   - small sources (some listings still carry 140x140 crop thumbs), which
  //     "cover" would blow up several times over into a blurry mess
  // Everything else keeps the full-bleed look.
  useEffect(() => {
    const src = images[current];
    if (!src || fits[current]) return;
    const probe = new Image();
    probe.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = probe;
      if (!w || !h) return;
      const rect = frameRef.current?.getBoundingClientRect();
      const fw = rect?.width || 380;
      const fh = rect?.height || 285;
      const coverScale = Math.max(fw / w, fh / h);
      // Fraction of the photo that "cover" would push outside the frame
      const cropped = 1 - (fw * fh) / (w * coverScale * h * coverScale);
      const letterbox = cropped > MAX_CROP || coverScale > MAX_UPSCALE;
      setFits(f => (f[current] ? f : { ...f, [current]: letterbox ? 'contain' : 'cover' }));
    };
    probe.src = src;
  }, [current, images, fits]);

  // The gallery's aspect flips at the sm breakpoint, so a photo that fits one
  // may not fit the other - re-measure when the frame resizes.
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

  const step = (delta: number) => {
    setCurrent(c => {
      const next = (c + delta + images.length) % images.length;
      onImageIndexChange?.(next);
      return next;
    });
  };

  const go = (delta: number, e: React.MouseEvent) => {
    e.stopPropagation();
    step(delta);
  };

  // Horizontal swipe flips photos on touch devices. Vertical-leaning drags are
  // left alone so the page/modal underneath still scrolls normally.
  const SWIPE_MIN = 45;
  const handleTouchStart = (e: React.TouchEvent) => {
    // Cleared here rather than on the click that follows: a swipe does not
    // always produce one, and a stale flag would swallow the next real tap.
    swipedRef.current = false;
    if (images.length < 2) return;
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) <= Math.abs(dy)) return;
    swipedRef.current = true;
    step(dx < 0 ? 1 : -1);
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

  const caption = imageHighlight || quoteFallback?.trim() || '';

  // Some sources repeat the room count in the size field — show it once.
  const sizeLine = [apartment.rooms, formatSize(apartment.size)]
    .map(s => String(s ?? '').trim())
    .filter((s, i, all) => s && all.indexOf(s) === i)
    .join(' · ');

  // Freshness chip: how recently the source listing was confirmed still live.
  // Claims "live on source", never "available" — availability is only settled at viewing time.

  // The page keeps its arrows up, so a detail card does too.
  const arrowsVisible = hover || noHover || detail;

  const description = useMemo(() => {
    const desc = apartment.description?.trim();
    if (!desc) return '';
    const lower = desc.toLowerCase();
    if (lower === displayTitle.trim().toLowerCase()) return '';
    if (caption && lower === caption.trim().toLowerCase()) return '';
    return desc;
  }, [apartment.description, displayTitle, caption]);

  // Nine on the page: three full rows of its three columns.
  const amenities = useMemo(
    () => getNormalizedAmenities(apartment.amenities, detail ? 9 : 12),
    [apartment.amenities, detail],
  );
  const hasAmenities = amenities.length > 0;

  const ratingLabel = vibeScore ? getVibeRatingLabel(Number(vibeScore.overall)) : null;

  // Overall vibe/style for the badge when there's no match score — the analysed
  // styles when available, else the display vibe string ("Modern, Elegant").
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

  const hasCoords = !!(apartment.latitude && apartment.longitude);
  const mapLat = hasCoords ? apartment.latitude! : geocodedCoords?.lat ?? 0;
  const mapLng = hasCoords ? apartment.longitude! : geocodedCoords?.lng ?? 0;

  // The sparkle summons the platform assistant about this listing. Fired as an
  // event rather than a prop so every card carries it without each surface
  // having to own a chat.
  const askAssistant = () => {
    const detail: AssistantOpenDetail = { propertyId: apartment.id, title: displayTitle };
    window.dispatchEvent(new CustomEvent(ASSISTANT_OPEN_EVENT, { detail }));
  };

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

  // A detail card gives the address two lines, as the page does; a shelf card
  // one.
  const locationButton = (
    <button
      className={`flex items-center gap-[7px] text-muted-foreground hover:text-foreground transition-colors w-fit max-w-full text-left ${compact ? 'text-[11.5px]' : 'text-[13px]'}`}
      onClick={handleLocationClick}
      disabled={isGeocoding}
      aria-label="Show on map"
    >
      <MapPin className="w-3.5 h-3.5 text-primary flex-shrink-0" />
      <span className={`underline decoration-border underline-offset-4 hover:decoration-foreground ${detail ? 'line-clamp-2' : 'line-clamp-1'}`}>
        {displayLocation}
      </span>
      {isGeocoding && <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />}
    </button>
  );

  return (
    <article
      className={`group w-full overflow-hidden rounded-[22px] bg-card text-foreground border border-border/60 ${onCardClick ? 'cursor-pointer' : ''} ${className}`}
      onClick={() => {
        if (swipedRef.current) {
          swipedRef.current = false;
          return;
        }
        onCardClick?.();
      }}
      role={onCardClick ? 'button' : undefined}
    >
      {/* ===== Gallery ===== */}
      <div
        ref={frameRef}
        className={`relative w-full ${aspectClass} overflow-hidden bg-foreground select-none`}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Blurred fill behind letterboxed photos */}
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
          style={{
            objectFit: fit,
            objectPosition: 'center',
            transition: `transform 1200ms ${EASE}`,
            // Zooming a letterboxed photo would crop it again - only cover
            // zooms. A detail card is not on a shelf, so it holds still.
            transform: hover && fit === 'cover' && !detail ? 'scale(1.07)' : 'scale(1)',
          }}
          onError={e => {
            const target = e.target as HTMLImageElement;
            target.onerror = null;
            target.src = '/placeholder-property.jpg';
          }}
        />

        {/* Scrim for caption legibility */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'linear-gradient(180deg, rgba(20,16,11,0.55) 0%, rgba(20,16,11,0) 26%, rgba(20,16,11,0) 44%, rgba(20,16,11,0.82) 100%)' }}
        />

        {/* Story-style progress segments */}
        {images.length > 1 && (
          <div className={`absolute flex gap-1.5 ${compact ? 'top-2.5 left-3.5 right-3.5' : 'top-4 left-5 right-5'}`}>
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

        {/* Share / like / close cluster */}
        <div className={`absolute flex items-center gap-2 ${compact ? 'top-6 right-3.5' : 'top-8 right-5'}`}>
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
            <Button
              size="icon"
              variant="secondary"
              aria-label="Ask Hausto Agent about this property"
              title="Ask the Hausto Assistant about this property"
              className="w-8 h-8 rounded-full border-0 backdrop-blur-md transition-all bg-primary/85 text-primary-foreground hover:bg-primary"
              onClick={e => {
                e.stopPropagation();
                askAssistant();
              }}
            >
              <Sparkles className="w-4 h-4" />
            </Button>
          </div>

        {/* Slideshow arrows */}
        {images.length > 1 && (
          <>
            <button
              aria-label="Previous photo"
              className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-[34px] h-[34px] rounded-full bg-black/40 text-white backdrop-blur-md flex items-center justify-center transition-opacity duration-300 hover:bg-black/60 ${arrowsVisible ? 'opacity-100' : 'opacity-0'} focus-visible:opacity-100`}
              onClick={e => go(-1, e)}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              aria-label="Next photo"
              className={`absolute right-3.5 top-1/2 -translate-y-1/2 w-[34px] h-[34px] rounded-full bg-black/40 text-white backdrop-blur-md flex items-center justify-center transition-opacity duration-300 hover:bg-black/60 ${arrowsVisible ? 'opacity-100' : 'opacity-0'} focus-visible:opacity-100`}
              onClick={e => go(1, e)}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </>
        )}

        {/* Per-photo highlight caption */}
        {caption && (
          <p
            className={`absolute font-serif italic text-white/95 leading-snug [text-wrap:pretty] ${compact ? 'left-4 right-4 bottom-3 text-[13px] line-clamp-2' : 'left-6 right-6 bottom-4 text-[15px] line-clamp-2'}`}
            style={{ transition: 'opacity 300ms ease' }}
          >
            {caption}
          </p>
        )}
      </div>

      {/* ===== Details ===== */}
      <div
        className={`flex flex-col ${
          compact ? 'gap-2.5 p-4' : detail ? 'gap-4 sm:gap-[18px] p-5 sm:px-6 sm:pt-[22px] sm:pb-6' : 'gap-3.5 p-5'
        }`}
      >
        {/* Badges */}
        <div className="flex flex-wrap gap-2">
          {/* Renters with preferences see how well it matches them; everyone
              else sees the property's own analysed style. Either way the
              badge opens the full vibe breakdown. */}
          {(ratingLabel || vibeStyles.length > 0) && (
            <VibeMatchPopover
              vibeScore={vibeScore}
              vibeMatch={vibeMatch ?? analysedVibe}
              vibeDetailsText={vibeDetailsText}
              scoreContext={scoreContext}
              note={vibeScore ? undefined : 'Sign in and set your preferences to see how well this place matches you.'}
            >
              <button
                type="button"
                aria-label="View match scoring details"
                className={`flex items-center gap-[7px] rounded-full bg-secondary text-secondary-foreground font-mono tracking-[0.12em] uppercase hover:bg-secondary/70 transition-colors ${compact ? 'px-2.5 py-1 text-[9.5px]' : 'px-3 py-1.5 text-[10.5px]'}`}
                onClick={e => e.stopPropagation()}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    ratingLabel ? RATING_DOT[ratingLabel] || 'bg-muted-foreground/50' : 'bg-primary'
                  }`}
                />
                <span className="line-clamp-1">{ratingLabel ? `${ratingLabel} match` : vibeStyles.join(' · ')}</span>
              </button>
            </VibeMatchPopover>
          )}
          {/* Opens the scan itself. It sits beside the match chip because both
              answer "is this place for me" - the score from the outside, the
              scan from the photos. Renters without a pass get the same panel and
              meet the paywall at its button, so what they are being asked to pay
              for is legible before they are asked. */}
          <Popover open={scanOpen} onOpenChange={setScanOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Open the Deep scan for this listing"
                className={`flex items-center gap-[5px] rounded-full bg-primary/10 text-primary whitespace-nowrap transition-colors hover:bg-primary/20 ${compact ? 'px-2.5 py-1 text-[10.5px]' : 'px-3 py-1.5 text-[11.5px]'}`}
                onClick={e => e.stopPropagation()}
              >
                <Search className={`flex-shrink-0 ${compact ? 'h-2.5 w-2.5' : 'h-3 w-3'}`} aria-hidden="true" />
                Deep scan
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-[calc(100vw-2rem)] max-w-sm p-4"
              collisionPadding={12}
              onClick={e => e.stopPropagation()}
            >
              <DeepVibeAnalysis
                bare
                ctaOnly
                propertyId={apartment.id}
                propertyType={propertyType}
                title={apartment.title}
                onRequestPass={() => {
                  setScanOpen(false);
                  requestPass();
                }}
                onScan={() => {
                  setScanOpen(false);
                  openDeepScan({
                    propertyId: apartment.id,
                    title: apartment.title,
                    propertyType: propertyType,
                  });
                }}
              />
            </PopoverContent>
          </Popover>
          </div>

        {detail ? (
          <>
            {/* The page's header: title + location left, price + spec right,
                generously spaced so a long title never crowds the price. On a
                phone the price drops to a full-width row under the title. */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-10">
              <div className="flex flex-col gap-2 min-w-0">
                <h3 className="font-serif font-medium text-2xl sm:text-[32px] leading-[1.06] [text-wrap:pretty]">
                  {displayTitle}
                </h3>
                {locationButton}
              </div>
              <div className="flex items-baseline justify-between gap-3 sm:flex-col sm:items-end sm:justify-start sm:gap-1.5 sm:flex-shrink-0 sm:text-right">
                <p className="font-serif font-semibold text-xl sm:text-[28px] leading-tight whitespace-nowrap">
                  {formatPrice(apartment.price)}
                  <span className="font-sans font-normal text-[13px] text-muted-foreground"> /mo</span>
                </p>
                {sizeLine && <p className="text-[12.5px] text-muted-foreground text-right">{sizeLine}</p>}
              </div>
            </div>

            {/* The whole description, then the amenities, both open - the
                page's order, with nothing behind a toggle. */}
            {description && (
              <p className="border-t border-border pt-[18px] text-[13.5px] leading-[1.6] text-muted-foreground text-justify hyphens-auto [text-wrap:pretty]">
                {description}
              </p>
            )}

            {hasAmenities && (
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
          </>
        ) : (
          <>
            {/* Title + location */}
            <div className="flex flex-col gap-2 min-w-0">
              <h3 className={`font-serif font-medium leading-[1.1] [text-wrap:pretty] ${compact ? 'text-[15px] line-clamp-2' : 'text-xl sm:text-[22px] line-clamp-3'}`}>
                {displayTitle}
              </h3>
              {locationButton}
            </div>

            {/* Price · spec, with the amenities toggle alongside the spec */}
            <div className="flex items-baseline justify-between gap-3">
              <p className={`font-serif font-semibold leading-tight whitespace-nowrap ${compact ? 'text-base' : 'text-xl'}`}>
                {formatPrice(apartment.price)}
                <span className={`font-sans font-normal text-muted-foreground ${compact ? 'text-[11px]' : 'text-[13px]'}`}> /mo</span>
              </p>
              <div className="flex items-center gap-2 min-w-0">
                {sizeLine && (
                  <span className={`text-muted-foreground text-right line-clamp-1 ${compact ? 'text-[11px]' : 'text-[12.5px]'}`}>
                    {sizeLine}
                  </span>
                )}
                {hasAmenities && (
                  <button
                    type="button"
                    aria-label={showAmenities ? 'Hide amenities' : 'Show amenities'}
                    aria-expanded={showAmenities}
                    title="Amenities"
                    className={`flex-shrink-0 flex items-center justify-center rounded-full border transition-colors ${compact ? 'w-6 h-6' : 'w-7 h-7'} ${showAmenities
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-secondary text-muted-foreground border-transparent hover:text-foreground'}`}
                    onClick={e => {
                      e.stopPropagation();
                      setShowAmenities(v => !v);
                    }}
                  >
                    <LayoutGrid className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
                  </button>
                )}
              </div>
            </div>

            {/* Amenities — behind the icon above rather than an always-open grid */}
            {hasAmenities && showAmenities && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-2.5 gap-y-2.5 border-t border-border pt-3">
                {amenities.map(({ key, label, icon: Icon }) => (
                  <div key={key} className={`flex items-center gap-2 text-foreground/85 ${compact ? 'text-[11px]' : 'text-[12.5px]'}`}>
                    {Icon ? (
                      <Icon className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                    ) : (
                      <span className="w-[7px] h-[7px] rounded-[2px] bg-primary flex-shrink-0" />
                    )}
                    <span className="line-clamp-1">{label}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Description — one line, expandable. A card can't afford the full
                prose the listing page shows. */}
            {description && (
              <div className="border-t border-border pt-3">
                <p className={`text-muted-foreground leading-[1.6] [text-wrap:pretty] ${descOpen ? '' : 'line-clamp-1'} ${compact ? 'text-[11.5px]' : 'text-[13px]'}`}>
                  {description}
                </p>
                <button
                  type="button"
                  aria-expanded={descOpen}
                  className={`mt-1 font-medium text-primary hover:underline underline-offset-2 ${compact ? 'text-[11px]' : 'text-[12px]'}`}
                  onClick={e => {
                    e.stopPropagation();
                    setDescOpen(v => !v);
                  }}
                >
                  {descOpen ? 'less' : 'more'}
                </button>
              </div>
            )}
          </>
        )}

        {/* CTAs. A lone button on a full-size card is held to a pill's width
            and centred over the centred small print under it - stretched
            across a wide modal it read as a banner, not a button. */}
        {(onContact || onSchedule || showShortlist) && (
          <div className={`flex items-center gap-2 ${detail ? 'mt-1' : 'pt-0.5'} ${loneCta ? 'justify-center' : ''}`}>
            {/* One button, not two. See RequestViewingModal for why. */}
            {showShortlist && (
              <Button
                size={ctaSize}
                className={ctaClass}
                onClick={e => { e.stopPropagation(); setRequestOpen(true); }}
              >
                Request viewing
              </Button>
            )}
            {onContact && (
              <Button
                size={ctaSize}
                variant={onSchedule ? 'outline' : 'default'}
                className={ctaClass}
                onClick={e => {
                  e.stopPropagation();
                  onContact();
                }}
              >
                {contactLabel}
              </Button>
            )}
            {/* onSchedule opened the retired Fast-Track scheduler. A card that
                offers both it and "Request viewing" is the confusion this
                change removes, so it only renders where the request modal is
                not on offer. */}
            {onSchedule && !showShortlist && (
              <Button
                size={ctaSize}
                className={ctaClass}
                onClick={e => {
                  e.stopPropagation();
                  onSchedule();
                }}
              >
                {scheduleLabel}
              </Button>
            )}
          </div>
        )}

        {/* No rule above it: the footer is the CTA's small print, and a line
            between them cut it off from the button it explains. */}
        {footer && (
          <div className={detail ? undefined : '-mt-1'} onClick={e => e.stopPropagation()}>
            {footer}
          </div>
        )}

        {showShortlist && (
          <RequestViewingModal
            open={requestOpen}
            onOpenChange={setRequestOpen}
            seed={{
              listingId: apartment.id,
              title: apartment.title,
              imageUrl: apartment.images?.[0] ?? null,
            }}
          />
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
