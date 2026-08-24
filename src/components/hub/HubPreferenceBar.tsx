import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChevronDown, Pencil, SlidersHorizontal, Zap } from 'lucide-react';
import { PreferencesEditModal } from '@/components/PreferencesEditModal';
import { SubscriptionStatus } from '@/components/SubscriptionStatus';
import { UsageMeter } from '@/components/UsageMeter';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useSubscription } from '@/hooks/useSubscription';
import { useUsageTracking } from '@/hooks/useUsageTracking';
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

const Chip = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col rounded-full border border-border bg-secondary px-3.5 py-1.5 leading-tight">
    <span className="text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
    <span className="text-[13px] font-medium">{value}</span>
  </div>
);

interface HubPreferenceBarProps {
  onOpenSubscription: () => void;
}

/**
 * The hub's standing context strip: what we think this renter wants, always in
 * view because every panel below is scored and filtered against it. The plan
 * pill hangs the subscription and usage cards off the same row so a quota wall
 * has somewhere obvious to point.
 */
export const HubPreferenceBar = ({ onOpenSubscription }: HubPreferenceBarProps) => {
  const { preferences } = useUserPreferences();
  const { formatPrice } = useCurrency();
  const { subscribed, subscription_tier: tier } = useSubscription();
  const { getRemainingActions } = useUsageTracking();
  const [isEditOpen, setIsEditOpen] = useState(false);

  const size = normalizeSize(preferences?.size);
  const mustHaves = (preferences?.mustHaves ?? [])
    .map((m) => FEATURE_LABELS[m as FeatureKey] || m)
    .slice(0, 2);
  const searchesLeft = getRemainingActions('ai-search');
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
      <section className="glass-card rounded-2xl px-4 py-3.5">
        <div className="mb-2.5 flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-2">
            <SlidersHorizontal className="h-[15px] w-[15px] shrink-0 text-primary" aria-hidden="true" />
            <span className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Your vibe</span>
            <span className="hidden truncate text-xs text-muted-foreground sm:inline">
              everything below is scored against it
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-11 px-2 text-muted-foreground sm:h-9 sm:px-3"
              onClick={() => setIsEditOpen(true)}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Edit</span>
            </Button>

            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-11 rounded-full border-primary/30 bg-primary/10 px-3 font-medium text-primary hover:bg-primary/15 hover:text-primary sm:h-9"
                >
                  <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">
                    {isPremium
                      ? 'Premium'
                      : `Free${Number.isFinite(searchesLeft) ? ` · ${searchesLeft} searches left` : ''}`}
                  </span>
                  <span className="sm:hidden">{isPremium ? 'Premium' : 'Free'}</span>
                  <ChevronDown className="h-3 w-3 opacity-60" aria-hidden="true" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[340px] space-y-3 p-3">
                <SubscriptionStatus onUpgrade={onOpenSubscription} />
                <UsageMeter />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {chips.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {chips.map((c) => (
              <Chip key={c.label} label={c.label} value={c.value} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nothing saved yet.{' '}
            <button
              className="font-medium text-primary underline underline-offset-4"
              onClick={() => setIsEditOpen(true)}
            >
              Tell us what you're after
            </button>{' '}
            and everything on this page starts scoring against it.
          </p>
        )}
      </section>

      <PreferencesEditModal
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        initial={preferences}
      />
    </>
  );
};
