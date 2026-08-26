import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChevronDown, ChevronLeft, ChevronRight, Crown, SlidersHorizontal, Zap } from 'lucide-react';
import { PreferencesEditModal } from '@/components/PreferencesEditModal';
import { UsageMeter } from '@/components/UsageMeter';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { FEATURE_LABELS, FeatureKey } from '@/lib/propertyFeatures';
import { normalizeSize } from '@/lib/preferences';

const SIZE_LABELS: Record<string, string> = {
  studio: 'Studio',
  '1br': '1 bedroom',
  '2br': '2 bedrooms',
  '3br+': '3+ bedrooms',
};

const MOVE_IN_LABELS: Record<string, string> = {
  asap: 'ASAP',
  '1month': 'Within a month',
  '3months': 'Within 3 months',
  '6months': '6+ months',
};

/** One line, label greyed and value in front-of-mind weight. */
const Chip = ({ label, value }: { label: string; value: string }) => (
  <span className="inline-flex shrink-0 items-baseline gap-1.5 rounded-full border border-border bg-secondary px-2.5 py-1 text-xs">
    <span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{label}</span>
    <span className="font-medium">{value}</span>
  </span>
);

interface HubPreferenceBarProps {
  onOpenSubscription: () => void;
}

/**
 * The hub's standing context strip: what we think this renter wants, kept to a
 * single line because it is reference, not the work. The plan pill hangs the
 * usage numbers off the same row so a quota wall has somewhere to point.
 */
export const HubPreferenceBar = ({ onOpenSubscription }: HubPreferenceBarProps) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { preferences } = useUserPreferences();
  const { formatPrice } = useCurrency();
  const { subscribed, subscription_tier: tier, subscription_end: endsAt } = useSubscription();
  const [isEditOpen, setIsEditOpen] = useState(false);

  // Whether the chip strip overflows, and where in it we are - drives the
  // arrows and the trailing fade.
  const chipsRef = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState(false);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  const updateScrollState = useCallback(() => {
    const el = chipsRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setCanScroll(max > 4);
    setAtStart(el.scrollLeft <= 4);
    setAtEnd(el.scrollLeft >= max - 4);
  }, []);

  // Recheck when the chips change and when the bar is resized - a wider window
  // can turn an overflowing strip into a fitting one.
  useEffect(() => {
    updateScrollState();
    const el = chipsRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateScrollState, preferences]);

  const scrollChips = (direction: 1 | -1) => {
    const el = chipsRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(160, el.clientWidth * 0.8), behavior: 'smooth' });
  };

  const size = normalizeSize(preferences?.size);
  const mustHaves = (preferences?.mustHaves ?? [])
    .map((m) => FEATURE_LABELS[m as FeatureKey] || m)
    .slice(0, 2);
  const isPremium = subscribed && tier === 'premium';

  const chips: { label: string; value: string }[] = [];
  if ((preferences?.styles ?? []).length > 0) {
    chips.push({ label: 'Style', value: preferences!.styles.slice(0, 2).join(' · ') });
  }
  if ((preferences?.location ?? []).length > 0) {
    chips.push({ label: 'Where', value: preferences!.location.slice(0, 3).join(' · ') });
  }
  if (size) chips.push({ label: 'Size', value: SIZE_LABELS[size] || size });
  if (preferences?.priceRange) {
    chips.push({
      label: 'Budget',
      value: `${formatPrice(preferences.priceRange[0])} - ${formatPrice(preferences.priceRange[1])}`,
    });
  }
  if (mustHaves.length > 0) chips.push({ label: 'Must-haves', value: mustHaves.join(' · ') });
  if (preferences?.moveInDate && MOVE_IN_LABELS[preferences.moveInDate]) {
    chips.push({ label: 'Move in', value: MOVE_IN_LABELS[preferences.moveInDate] });
  }

  return (
    <>
      <section className="flex items-center gap-2 rounded-full border border-border bg-white/70 p-1.5 backdrop-blur-xl">
        {/* The strip's own glyph is the way into the editor - it used to be
            decoration with a pencil at the far end doing the work, which put
            the control a whole bar away from the thing it edits. Signed out
            there is nowhere to save to, so it asks for an account instead. */}
        <button
          type="button"
          aria-label="Adjust your vibe preferences"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-primary transition-colors hover:bg-primary/10"
          onClick={() =>
            user ? setIsEditOpen(true) : navigate('/auth', { state: { returnTo: '/hub' } })
          }
        >
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
        </button>

        {/* Steps the strip by roughly one screenful. Touch can swipe, but a
            mouse has nothing to grab once the scrollbar is hidden. */}
        {canScroll && (
          <button
            aria-label="Previous preferences"
            disabled={atStart}
            className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary disabled:opacity-30 sm:flex"
            onClick={() => scrollChips(-1)}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
        )}

        {/* Chips scroll sideways rather than wrapping the bar onto a second
            line. The fade on the trailing edge cues that there is more to
            reach, since the scrollbar is hidden. */}
        <div
          ref={chipsRef}
          onScroll={updateScrollState}
          className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{
            WebkitOverflowScrolling: 'touch',
            touchAction: 'pan-x',
            maskImage: atEnd ? undefined : 'linear-gradient(to right, #000 calc(100% - 16px), transparent)',
            WebkitMaskImage: atEnd ? undefined : 'linear-gradient(to right, #000 calc(100% - 16px), transparent)',
          }}
        >
          {chips.length > 0 ? (
            <div className="flex w-max items-center gap-1.5">
              {chips.map((c) => (
                <Chip key={c.label} label={c.label} value={c.value} />
              ))}
            </div>
          ) : (
            <button
              className="whitespace-nowrap text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
              // Preferences have nowhere to save without an account, so a
              // signed-out visitor is asked to sign in rather than handed a
              // form that quietly loses their answers.
              onClick={() =>
                user ? setIsEditOpen(true) : navigate('/auth', { state: { returnTo: '/hub' } })
              }
            >
              {/* The full sentence is a long sideways scroll on a phone. */}
              <span className="sm:hidden">Tell us what you're after</span>
              <span className="hidden sm:inline">
                Tell us what you're after and everything here starts scoring against it
              </span>
            </button>
          )}
        </div>

        {canScroll && (
          <button
            aria-label="More preferences"
            disabled={atEnd}
            className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary disabled:opacity-30 sm:flex"
            onClick={() => scrollChips(1)}
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        )}

        <div className="flex shrink-0 items-center gap-1">
          {user && (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 rounded-full px-2.5 text-xs font-medium text-primary hover:bg-primary/10 hover:text-primary"
              >
                {isPremium ? (
                  <Crown className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {isPremium ? 'Premium' : 'Free'}
                <ChevronDown className="h-3 w-3 opacity-60" aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[320px] space-y-3 p-3">
              {/* Deliberately just the numbers and the action - what the plan
                  includes belongs on the profile page, not in a chip popover
                  someone opened to check how much they have left. */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">
                  {isPremium ? 'Premium plan' : 'Free plan'}
                </span>
                {isPremium && endsAt && (
                  <span className="text-[11px] text-muted-foreground">
                    Renews {new Date(endsAt).toLocaleDateString()}
                  </span>
                )}
              </div>

              <UsageMeter />

              {!isPremium && (
                <Button className="w-full" size="sm" onClick={onOpenSubscription}>
                  <Crown className="h-3.5 w-3.5" aria-hidden="true" />
                  Upgrade to Premium
                </Button>
              )}
            </PopoverContent>
          </Popover>
          )}
        </div>
      </section>

      <PreferencesEditModal
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        initial={preferences}
      />
    </>
  );
};
