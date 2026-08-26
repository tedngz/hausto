import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, Loader2, Save } from 'lucide-react';
import { UserPreferences } from '@/types';
import { BudgetRangeSelector } from '@/components/BudgetRangeSelector';
import { CityDistrictSelector } from '@/components/CityDistrictSelector';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { normalizeSize } from '@/lib/preferences';
import { MUST_HAVE_OPTIONS } from '@/lib/propertyFeatures';

// Kept in sync with the (simplified) onboarding quiz options.
const STYLE_OPTIONS = ['Modern', 'Cozy', 'Industrial', 'Scandinavian', 'Minimalist', 'Luxury'];
const ACTIVITY_OPTIONS = ['Working', 'Reading', 'Relaxing', 'Entertaining', 'Cooking', 'Exercising'];
const SIZE_OPTIONS: { id: string; label: string }[] = [
  { id: 'studio', label: 'Studio' },
  { id: '1br', label: '1 Bedroom' },
  { id: '2br', label: '2 Bedrooms' },
  { id: '3br+', label: '3+ Bedrooms' },
];
const MOVE_IN_OPTIONS: { id: string; label: string }[] = [
  { id: 'asap', label: 'ASAP' },
  { id: '1month', label: 'Within a month' },
  { id: '3months', label: 'Within 3 months' },
  { id: '6months', label: '6+ months' },
];

interface PreferencesEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  initial: UserPreferences | null;
  onSaved?: (prefs: UserPreferences) => void;
}

const DEFAULTS: UserPreferences = {
  styles: [],
  activities: [],
  mustHaves: [],
  priceRange: [8000000, 15000000],
  size: '',
  location: [],
  moveInDate: '',
};

const Chip = ({
  selected,
  label,
  onClick,
}: {
  selected: boolean;
  label: string;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`px-2.5 py-1 rounded-full border text-xs transition-colors ${
      selected
        ? 'bg-primary text-primary-foreground border-primary'
        : 'bg-background border-border hover:border-primary/50'
    }`}
  >
    {label}
  </button>
);

/** A labelled run of chips. The label is small caps so it reads as a caption
 *  rather than as another heading competing with the dialog title. */
const Field = ({
  title,
  hint,
  className = '',
  children,
}: {
  title: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) => (
  <section className={className}>
    <h4 className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
      {title}
      {hint && <span className="ml-2 normal-case tracking-normal opacity-70">{hint}</span>}
    </h4>
    <div className="flex flex-wrap gap-1.5">{children}</div>
  </section>
);

/**
 * A section folded away behind its own answer.
 *
 * Budget and areas are both full pickers - presets, a slider, a
 * city-then-district drill-down - and laid out flat they were most of this
 * dialog's height, which pushed the six one-tap questions above them off a
 * laptop screen. Closed, each is a single line stating what it is currently set
 * to, which is what someone opening the editor usually wants to check anyway.
 */
const Disclosure = ({
  label,
  summary,
  children,
}: {
  label: string;
  summary: string;
  children: React.ReactNode;
}) => (
  <Collapsible className="rounded-lg border border-border">
    <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 px-3 py-2 text-left">
      <span className="shrink-0 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-xs font-medium">{summary}</span>
        <ChevronDown
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
          aria-hidden="true"
        />
      </span>
    </CollapsibleTrigger>
    <CollapsibleContent className="border-t border-border px-3 py-3">
      {children}
    </CollapsibleContent>
  </Collapsible>
);

/** Split out so the currency context is only read while the dialog is open. */
const BudgetField = ({
  value,
  onChange,
}: {
  value: [number, number];
  onChange: (v: [number, number]) => void;
}) => {
  const { formatPrice } = useCurrency();
  return (
    <Disclosure label="Budget" summary={`${formatPrice(value[0])} - ${formatPrice(value[1])}`}>
      <BudgetRangeSelector value={value} onChange={onChange} />
    </Disclosure>
  );
};

export const PreferencesEditModal = ({
  isOpen,
  onClose,
  initial,
  onSaved,
}: PreferencesEditModalProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { savePreferences, isSaving } = useUserPreferences();
  const [prefs, setPrefs] = useState<UserPreferences>(initial ?? DEFAULTS);

  // Re-sync when the modal is (re)opened with fresh data.
  useEffect(() => {
    if (isOpen) setPrefs(initial ?? DEFAULTS);
  }, [isOpen, initial]);

  const toggleMulti = (key: 'styles' | 'activities' | 'mustHaves', value: string) => {
    setPrefs((prev) => {
      const list = prev[key] ?? [];
      return {
        ...prev,
        [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value],
      };
    });
  };

  const setSingle = (key: 'size' | 'moveInDate', value: string) => {
    setPrefs((prev) => ({ ...prev, [key]: prev[key] === value ? '' : value }));
  };

  const handleSave = async () => {
    if (!user?.id) return;
    try {
      await savePreferences(prefs);
      toast({
        title: 'Preferences updated',
        description: 'Your next AI search will use these.',
      });
      onSaved?.(prefs);
      onClose();
    } catch (e) {
      console.error('Failed to save preferences:', e);
      toast({
        title: 'Could not save',
        description: 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  const size = normalizeSize(prefs.size);
  const areas = prefs.location ?? [];
  const areaSummary =
    areas.length === 0
      ? 'Anywhere'
      : areas.length <= 2
        ? areas.join(', ')
        : `${areas.length} areas`;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85dvh] gap-3 overflow-y-auto p-4 sm:p-5">
        <DialogHeader className="space-y-1">
          <DialogTitle className="text-base">Edit your preferences</DialogTitle>
          <DialogDescription className="text-xs">
            Tweak any part - no need to redo the whole quiz.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Two columns from sm up: these are all short chip runs, and stacked
              they turned six quick questions into a long scroll. */}
          <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
            <Field title="Style">
              {STYLE_OPTIONS.map((s) => (
                <Chip
                  key={s}
                  label={s}
                  selected={(prefs.styles ?? []).includes(s)}
                  onClick={() => toggleMulti('styles', s)}
                />
              ))}
            </Field>

            <Field title="Home lifestyle">
              {ACTIVITY_OPTIONS.map((a) => (
                <Chip
                  key={a}
                  label={a}
                  selected={(prefs.activities ?? []).includes(a)}
                  onClick={() => toggleMulti('activities', a)}
                />
              ))}
            </Field>

            {/* Nine options - it needs the full width whatever the column count */}
            <Field
              title="Must-haves"
              hint="deal-breakers your top matches must have"
              className="sm:col-span-2"
            >
              {MUST_HAVE_OPTIONS.map((o) => (
                <Chip
                  key={o.id}
                  label={o.label}
                  selected={(prefs.mustHaves ?? []).includes(o.id)}
                  onClick={() => toggleMulti('mustHaves', o.id)}
                />
              ))}
            </Field>

            <Field title="Size">
              {SIZE_OPTIONS.map((o) => (
                <Chip
                  key={o.id}
                  label={o.label}
                  selected={size === o.id}
                  onClick={() => setSingle('size', o.id)}
                />
              ))}
            </Field>

            <Field title="Move-in">
              {MOVE_IN_OPTIONS.map((o) => (
                <Chip
                  key={o.id}
                  label={o.label}
                  selected={prefs.moveInDate === o.id}
                  onClick={() => setSingle('moveInDate', o.id)}
                />
              ))}
            </Field>
          </div>

          <BudgetField
            value={prefs.priceRange}
            onChange={(v) => setPrefs((prev) => ({ ...prev, priceRange: v }))}
          />

          <Disclosure label="Areas" summary={areaSummary}>
            <CityDistrictSelector
              value={areas}
              onChange={(v) => setPrefs((prev) => ({ ...prev, location: v }))}
            />
          </Disclosure>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
