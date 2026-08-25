import { useEffect, useMemo, useState } from 'react';
import { Loader2, MapPin, Sparkles } from 'lucide-react';

import { useComplexes, CITY_LABEL, type Complex } from '@/hooks/useComplexes';
import { ComplexCard } from '@/components/ComplexCard';
import { ComplexFilters } from '@/components/ComplexFilters';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { HubComplexPanel } from '@/components/hub/HubComplexPanel';
import {
  ASSISTANT_COMPARE_EVENT,
  ASSISTANT_OPEN_EVENT,
  type AssistantCompareDetail,
  type AssistantOpenDetail,
  listSubjects,
} from '@/lib/assistantEvents';
import { HUB_PANEL_POSITION, HUB_PANE_CENTRED } from '@/lib/hubLayout';

/** Rent bands are stored per unit type and quoted in USD, as on the profile. */
const rentBand = (c: Complex, key: string): string => {
  const band = c.average_rent_brackets?.[key];
  return band ? `$${band.min.toLocaleString()} - $${band.max.toLocaleString()}` : '-';
};

// The facts renters actually weigh one building against another on. Deliberately
// the same shape as the browse table's compare rows: same gesture, same reading.
const COMPARE_FIELDS: { label: string; get: (c: Complex) => string }[] = [
  { label: '1BR rent', get: (c) => rentBand(c, '1br') },
  { label: '2BR rent', get: (c) => rentBand(c, '2br') },
  { label: 'Completed', get: (c) => (c.year_completed ? String(c.year_completed) : '-') },
  { label: 'Managed by', get: (c) => c.management_company || '-' },
  { label: 'Pets', get: (c) => c.pet_policy || '-' },
];



/**
 * The vetted-complex directory: filters plus the card grid.
 *
 * Lifted out of the /complexes page so the hub can carry it as a tab without
 * duplicating the filtering. The public page keeps its own hero around this;
 * the hub just drops it into the main pane.
 */
interface ComplexDirectoryProps {
  /** In the hub: profiles open in place, cards gain select + ask affordances. */
  embedded?: boolean;
  /** Tells the host a compare panel is on screen, so it doesn't move the pane
   *  out from under it - unmounting this grid would close the panel. */
  onCompareOpenChange?: (open: boolean) => void;
}

export const ComplexDirectory = ({ embedded = false, onCompareOpenChange }: ComplexDirectoryProps) => {
  const { data: complexes, isLoading } = useComplexes();
  const [city, setCity] = useState<string | null>(null);
  const [district, setDistrict] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [openComplex, setOpenComplex] = useState<Complex | null>(null);
  const [selected, setSelected] = useState<Complex[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);

  // Mirrors up while the panel is open, and on the way out - a host left
  // holding a stale `true` would never switch panes again.
  useEffect(() => {
    onCompareOpenChange?.(compareOpen);
    return () => onCompareOpenChange?.(false);
  }, [compareOpen, onCompareOpenChange]);

  const toggleSelect = (c: Complex) =>
    setSelected((cur) =>
      cur.some((x) => x.id === c.id) ? cur.filter((x) => x.id !== c.id) : [...cur, c],
    );

  // Complexes ride the same subject channel as listings: the chat treats both
  // as "the thing we are talking about", so one pinned strip covers both.
  const askAboutOne = (c: Complex) => {
    window.dispatchEvent(
      new CustomEvent<AssistantOpenDetail>(ASSISTANT_OPEN_EVENT, {
        detail: { propertyId: c.id, title: c.name },
      }),
    );
  };

  // Both halves of the gesture, like the browse table's Compare: the buildings
  // go side by side in the panel, and the same question is put to the chat, so
  // the facts and the opinion about them are on screen together.
  const compareSelected = () => {
    if (selected.length < 2) return;
    setCompareOpen(true);
    window.dispatchEvent(
      new CustomEvent<AssistantCompareDetail>(ASSISTANT_COMPARE_EVENT, {
        detail: {
          properties: selected.map((c) => ({ propertyId: c.id, title: c.name })),
          // Names go in the message itself, not just the pinned ids. The ids
          // give the model the full record, but naming them means the question
          // still reads as a real question on its own - "compare these two"
          // with no antecedent is how you get "which buildings do you mean?".
          prompt: `Compare ${listSubjects(selected.map((c) => c.name))} for me - which suits me best, and what are the tradeoffs?`,
        },
      }),
    );
  };

  const districts = useMemo(() => {
    const set = new Set<string>();
    (complexes ?? []).filter((c) => !city || c.city === city).forEach((c) => set.add(c.district));
    return Array.from(set).sort();
  }, [complexes, city]);

  const tags = useMemo(() => {
    const set = new Set<string>();
    (complexes ?? []).forEach((c) => c.tags?.forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [complexes]);

  const filtered = useMemo(() => {
    return (complexes ?? []).filter((c) => {
      if (city && c.city !== city) return false;
      if (district && c.district !== district) return false;
      if (tag && !(c.tags ?? []).includes(tag)) return false;
      return true;
    });
  }, [complexes, city, district, tag]);

  return (
    <>
      <div className="mb-6 space-y-6">
        <ComplexFilters
          city={city} setCity={setCity}
          district={district} setDistrict={setDistrict}
          tag={tag} setTag={setTag}
          districts={districts}
          tags={tags}
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center text-muted-foreground">
          No complexes match these filters yet. Try widening your search.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <ComplexCard
              key={c.id}
              complex={c}
              onOpen={embedded ? setOpenComplex : undefined}
              onAskAI={embedded ? askAboutOne : undefined}
              onToggleSelect={embedded ? toggleSelect : undefined}
              selected={selected.some((s) => s.id === c.id)}
            />
          ))}
        </div>
      )}

      {embedded && (
        <>
          {/* Compare bar, matching the browse table's - same gesture, same
              place on screen, whichever kind of thing is selected. */}
          {selected.length > 0 && (
            <div className={`fixed bottom-20 z-40 flex items-center gap-3 rounded-full bg-foreground px-5 py-2.5 text-background shadow-lg xl:bottom-6 ${HUB_PANE_CENTRED}`}>
              <span className="text-sm">{selected.length} selected</span>
              <Button
                size="sm"
                className="h-7 rounded-full"
                disabled={selected.length < 2}
                onClick={compareSelected}
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                Compare
              </Button>
              <button
                className="text-xs opacity-70 hover:opacity-100"
                onClick={() => setSelected([])}
              >
                Clear
              </button>
            </div>
          )}

          {/* Side-by-side facts only - the same division of labour the browse
              table's compare panel keeps. Which one to take is the question
              already sitting in the chat rail beside this. Not modal: reading
              the answer while reading the panel is the whole point. */}
          <Dialog open={compareOpen} modal={false} onOpenChange={setCompareOpen}>
            <DialogContent
              overlayClassName="hidden"
              className={`max-w-4xl overflow-y-auto ${HUB_PANEL_POSITION}`}
            >
              <DialogHeader><DialogTitle>Compare complexes</DialogTitle></DialogHeader>
              {/* One card per building: side by side on desktop, horizontal
                  snap scroll on mobile so each gets full width */}
              <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-1 [scrollbar-width:thin]">
                {selected.map((c, i) => (
                  <div
                    key={c.id}
                    className="snap-start flex w-[80vw] max-w-[280px] flex-shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card sm:w-auto sm:min-w-[220px] sm:flex-1"
                  >
                    <div className="aspect-[4/3] w-full overflow-hidden bg-muted">
                      {c.hero_image && (
                        <img src={c.hero_image} alt={c.name} loading="lazy" className="h-full w-full object-cover" />
                      )}
                    </div>
                    <div className="flex flex-1 flex-col gap-2 p-3">
                      <button
                        className="line-clamp-2 text-left text-sm font-medium hover:underline"
                        onClick={() => setOpenComplex(c)}
                      >
                        <span className="mr-1 text-muted-foreground">{i + 1}.</span>{c.name}
                      </button>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
                        <span className="line-clamp-1">{c.district}, {CITY_LABEL[c.city] ?? c.city}</span>
                      </p>

                      <dl className="mt-1 space-y-1 text-xs">
                        {COMPARE_FIELDS.map((f) => (
                          <div key={f.label} className="flex justify-between gap-2">
                            <dt className="text-muted-foreground">{f.label}</dt>
                            <dd className="text-right font-medium">{f.get(c)}</dd>
                          </div>
                        ))}
                      </dl>

                      {c.tags && c.tags.length > 0 && (
                        <div className="mt-auto flex flex-wrap gap-1 border-t border-border pt-2">
                          {c.tags.slice(0, 4).map((t) => (
                            <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </DialogContent>
          </Dialog>

          <HubComplexPanel
            complex={openComplex}
            onClose={() => setOpenComplex(null)}
            onAskAI={askAboutOne}
          />
        </>
      )}
    </>
  );
};
