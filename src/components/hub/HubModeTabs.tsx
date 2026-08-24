import { Heart, LayoutList, Sparkles } from 'lucide-react';

export type HubMode = 'browse' | 'ai' | 'matches';

interface HubModeTabsProps {
  mode: HubMode;
  onChange: (mode: HubMode) => void;
  /** Per-tab counts; undefined hides the pill rather than showing a zero. */
  counts?: Partial<Record<HubMode, number | undefined>>;
}

const TABS: { id: HubMode; label: string; icon: typeof Heart }[] = [
  { id: 'browse', label: 'Browse', icon: LayoutList },
  { id: 'ai', label: 'AI results', icon: Sparkles },
  { id: 'matches', label: 'Matches', icon: Heart },
];

/**
 * Swaps what the hub's main pane shows. The active fill mirrors the top nav's
 * icon buttons so the two read as the same control family.
 */
export const HubModeTabs = ({ mode, onChange, counts }: HubModeTabsProps) => (
  <div
    role="tablist"
    aria-label="What the main pane shows"
    className="inline-flex w-full gap-1 rounded-full border border-border bg-secondary p-1 sm:w-auto"
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
          className={`inline-flex h-11 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-full px-3 text-sm font-medium transition-colors sm:h-9 sm:flex-none sm:px-4 ${
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
