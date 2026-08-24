import { useMemo, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';

import { useComplexes, type Complex } from '@/hooks/useComplexes';
import { ComplexCard } from '@/components/ComplexCard';
import { ComplexFilters } from '@/components/ComplexFilters';
import { Button } from '@/components/ui/button';
import { HubComplexPanel } from '@/components/hub/HubComplexPanel';
import {
  ASSISTANT_COMPARE_EVENT,
  ASSISTANT_OPEN_EVENT,
  type AssistantCompareDetail,
  type AssistantOpenDetail,
  listSubjects,
} from '@/lib/assistantEvents';
import { HUB_PANE_CENTRED } from '@/lib/hubLayout';



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
}

export const ComplexDirectory = ({ embedded = false }: ComplexDirectoryProps) => {
  const { data: complexes, isLoading } = useComplexes();
  const [city, setCity] = useState<string | null>(null);
  const [district, setDistrict] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [openComplex, setOpenComplex] = useState<Complex | null>(null);
  const [selected, setSelected] = useState<Complex[]>([]);

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

  const compareSelected = () => {
    if (selected.length < 2) return;
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
                Compare with AI
              </Button>
              <button
                className="text-xs opacity-70 hover:opacity-100"
                onClick={() => setSelected([])}
              >
                Clear
              </button>
            </div>
          )}

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
