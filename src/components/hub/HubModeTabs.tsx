import { Building2, CalendarCheck, Heart, LayoutList, Map, Sparkles } from 'lucide-react';

export type HubMode = 'browse' | 'ai' | 'matches' | 'complexes' | 'map' | 'viewings';

interface HubModeTabsProps {
  mode: HubMode;
  onChange: (mode: HubMode) => void;
  /** Per-tab counts; undefined hides the pill rather than showing a zero. */
  counts?: Partial<Record<HubMode, number | undefined>>;
}

// Ordered by how the inventory narrows: the three ways to look at everything
// we have (the table, the buildings, the map) sit together on the left, and the
// two panes that are about this renter in particular come after them.
const TABS: { id: HubMode; label: string; icon: typeof Heart }[] = [
  { id: 'browse', label: 'Browse', icon: LayoutList },
  { id: 'complexes', label: 'Complexes', icon: Building2 },
  { id: 'map', label: 'Map', icon: Map },
  { id: 'ai', label: 'AI results', icon: Sparkles },
  { id: 'matches', label: 'Matches', icon: Heart },
  // Last, and the only tab about something already in motion rather than
  // something still being chosen.
  { id: 'viewings', label: 'Viewings', icon: CalendarCheck },
];

/**
 * Swaps what the hub's main pane shows. The active fill mirrors the top nav's
 * icon buttons so the two read as the same control family.
 */
export const HubModeTabs = ({ mode, onChange, counts }: HubModeTabsProps) => (
  // Six tabs do not fit a phone at equal widths, so the strip scrolls rather
  // than squeezing the labels out.
  <div
    role="tablist"
    aria-label="What the main pane shows"
    className="inline-flex max-w-full gap-1 overflow-x-auto rounded-full border border-border bg-secondary p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
  >
    {TABS.map(({ id, label, icon: Icon }) => {
      const active = mode === id;
      const count = counts?.[id];
      return (
        <button
          key={id}
          role="tab"
          type="button"
          aria-selected={active}
          onClick={() => onChange(id)}
          className={`inline-flex h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full px-3.5 text-sm font-medium transition-colors sm:h-9 sm:px-4 ${
            active
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{label}</span>
          {count !== undefined && count > 0 && (
            <span
              className={`rounded-full px-1.5 py-px text-[11px] font-semibold leading-tight ${
                active ? 'bg-white/25' : 'bg-black/5'
              }`}
            >
              {count > 999 ? '999+' : count}
            </span>
          )}
        </button>
      );
    })}
  </div>
);
