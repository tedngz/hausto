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
import { Badge } from '@/components/ui/badge';
import { Loader2, Save } from 'lucide-react';
import { UserPreferences } from '@/types';
import { BudgetRangeSelector } from '@/components/BudgetRangeSelector';
import { CityDistrictSelector } from '@/components/CityDistrictSelector';
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
    className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${
      selected
        ? 'bg-primary text-primary-foreground border-primary'
        : 'bg-background border-border hover:border-primary/50'
    }`}
  >
    {label}
  </button>
);

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

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit your preferences</DialogTitle>
          <DialogDescription>
            Tweak any part below — no need to redo the whole quiz.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Styles */}
          <section>
            <h4 className="font-medium text-sm mb-2">Style</h4>
            <div className="flex flex-wrap gap-2">
              {STYLE_OPTIONS.map((s) => (
                <Chip
                  key={s}
                  label={s}
                  selected={(prefs.styles ?? []).includes(s)}
                  onClick={() => toggleMulti('styles', s)}
                />
              ))}
            </div>
          </section>

          {/* Must-haves */}
          <section>
            <h4 className="font-medium text-sm mb-2">Must-haves</h4>
            <p className="text-xs text-muted-foreground mb-2">Deal-breakers your top matches must have.</p>
            <div className="flex flex-wrap gap-2">
              {MUST_HAVE_OPTIONS.map((o) => (
                <Chip
                  key={o.id}
                  label={o.label}
                  selected={(prefs.mustHaves ?? []).includes(o.id)}
                  onClick={() => toggleMulti('mustHaves', o.id)}
                />
              ))}
            </div>
          </section>

          {/* Activities */}
          <section>
            <h4 className="font-medium text-sm mb-2">Home lifestyle</h4>
            <div className="flex flex-wrap gap-2">
              {ACTIVITY_OPTIONS.map((a) => (
                <Chip
                  key={a}
                  label={a}
                  selected={(prefs.activities ?? []).includes(a)}
                  onClick={() => toggleMulti('activities', a)}
                />
              ))}
            </div>
          </section>

          {/* Size */}
          <section>
            <h4 className="font-medium text-sm mb-2">Size</h4>
            <div className="flex flex-wrap gap-2">
              {SIZE_OPTIONS.map((o) => (
                <Chip
                  key={o.id}
                  label={o.label}
                  selected={size === o.id}
                  onClick={() => setSingle('size', o.id)}
                />
              ))}
            </div>
          </section>

          {/* Budget */}
          <section>
            <h4 className="font-medium text-sm mb-3">Budget</h4>
            <BudgetRangeSelector
              value={prefs.priceRange}
              onChange={(v) => setPrefs((prev) => ({ ...prev, priceRange: v }))}
            />
          </section>

          {/* Location */}
          <section>
            <h4 className="font-medium text-sm mb-2">Preferred areas</h4>
            {(prefs.location ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {prefs.location.map((l) => (
                  <Badge key={l} variant="secondary" className="text-xs">
                    {l}
                  </Badge>
                ))}
              </div>
            )}
            <CityDistrictSelector
              value={prefs.location ?? []}
              onChange={(v) => setPrefs((prev) => ({ ...prev, location: v }))}
            />
          </section>

          {/* Move-in */}
          <section>
            <h4 className="font-medium text-sm mb-2">Move-in timeline</h4>
            <div className="flex flex-wrap gap-2">
              {MOVE_IN_OPTIONS.map((o) => (
                <Chip
                  key={o.id}
                  label={o.label}
                  selected={prefs.moveInDate === o.id}
                  onClick={() => setSingle('moveInDate', o.id)}
                />
              ))}
            </div>
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
