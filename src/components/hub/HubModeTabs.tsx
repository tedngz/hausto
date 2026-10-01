import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Building2, CalendarCheck, Heart, LayoutList, Map as MapIcon, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export type HubMode = 'browse' | 'ai' | 'matches' | 'complexes' | 'map' | 'viewings';

interface HubModeTabsProps {
  mode: HubMode;
  onChange: (mode: HubMode) => void;
  /** Per-tab counts; undefined hides the pill rather than showing a zero. */
  counts?: Partial<Record<HubMode, number | undefined>>;
  /** The element the tabs swap the contents of, for aria-controls. */
  panelId?: string;
  className?: string;
}

type Tab = { id: HubMode; label: string; icon: typeof Heart };

// Two groups with a hairline between them. On the left, the three ways to look
// at everything we have - the table, the buildings, the map. On the right, the
// three about this renter in particular: what the AI found them, what they
// kept, and last, the only one about something already in motion rather than
// something still being chosen.
const GROUPS: Tab[][] = [
  [
    { id: 'browse', label: 'Browse', icon: LayoutList },
    { id: 'complexes', label: 'Complexes', icon: Building2 },
    { id: 'map', label: 'Map', icon: MapIcon },
  ],
  [
    { id: 'ai', label: 'AI results', icon: Sparkles },
    { id: 'matches', label: 'Matches', icon: Heart },
    { id: 'viewings', label: 'Viewings', icon: CalendarCheck },
  ],
];
const ORDER = GROUPS.flat().map((t) => t.id);

/** Keeps a sliver of the neighbouring tab in view, so an edge reads as more to scroll. */
const SCROLL_MARGIN = 32;

/**
 * Swaps what the hub's main pane shows. It is the pane's header bar: at xl its
 * hairline runs level with the one under the chat rail's "Hausto Agent"
 * heading, so the two panes share one header line across the page.
 *
 * The active tab is marked by an underline that slides between tabs, sitting
 * on the hairline itself. It spans the tab's label rather than its padding, so
 * under the first tab it lines up with the left edge of the content below.
 */
export const HubModeTabs = ({ mode, onChange, counts, panelId, className }: HubModeTabsProps) => {
  const listRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<HubMode, HTMLButtonElement>());
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);
  // Off for the first placement, so the underline appears under its tab
  // rather than sliding in from the left edge on load.
  const [animate, setAnimate] = useState(false);
  // Which ends of the strip have tabs scrolled out past them - drives the fades.
  const [overflow, setOverflow] = useState({ start: false, end: false });

  const updateOverflow = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const max = list.scrollWidth - list.clientWidth;
    setOverflow((prev) => {
      const next = { start: list.scrollLeft > 1, end: list.scrollLeft < max - 1 };
      return prev.start === next.start && prev.end === next.end ? prev : next;
    });
  }, []);

  // Measured from the tab's padding box inwards, so the underline matches the
  // label whatever padding the class list gives the tab.
  const measure = useCallback(() => {
    const tab = tabRefs.current.get(mode);
    if (!tab) return;
    const style = getComputedStyle(tab);
    const padLeft = parseFloat(style.paddingLeft) || 0;
    const padRight = parseFloat(style.paddingRight) || 0;
    setIndicator((prev) => {
      const next = { left: tab.offsetLeft + padLeft, width: tab.offsetWidth - padLeft - padRight };
      return prev && prev.left === next.left && prev.width === next.width ? prev : next;
    });
    updateOverflow();
  }, [mode, updateOverflow]);

  // Before paint, so a tab switch never shows the underline under the old tab.
  // Every tab is observed, not just the active one: a count pill appearing on a
  // tab to its left moves it without resizing it.
  useLayoutEffect(() => {
    measure();
    const list = listRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    tabRefs.current.forEach((tab) => ro.observe(tab));
    return () => ro.disconnect();
  }, [measure]);

  // Web fonts can land after the first measurement and change every width.
  useEffect(() => {
    document.fonts?.ready.then(measure).catch(() => {});
  }, [measure]);

  useEffect(() => {
    if (!indicator || animate) return;
    const frame = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(frame);
  }, [indicator, animate]);

  // The hub switches tabs on its own - to AI results when a search lands - so
  // the strip brings the active tab into view rather than leaving it scrolled
  // off the end of a phone screen. Horizontal only: scrollIntoView would also
  // drag the page up to the tabs.
  useEffect(() => {
    const list = listRef.current;
    const tab = tabRefs.current.get(mode);
    if (!list || !tab) return;
    const start = tab.offsetLeft - SCROLL_MARGIN;
    const end = tab.offsetLeft + tab.offsetWidth + SCROLL_MARGIN;
    if (start < list.scrollLeft) {
      list.scrollTo({ left: Math.max(0, start), behavior: 'smooth' });
    } else if (end > list.scrollLeft + list.clientWidth) {
      list.scrollTo({ left: end - list.clientWidth, behavior: 'smooth' });
    }
  }, [mode]);

  // Arrow keys move focus between tabs and Enter or Space opens one. Not
  // opening on arrow alone: each pane fetches as it mounts, so arrowing across
  // the strip would load every pane on the way.
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, id: HubMode) => {
    const i = ORDER.indexOf(id);
    const target = {
      ArrowRight: ORDER[(i + 1) % ORDER.length],
      ArrowLeft: ORDER[(i - 1 + ORDER.length) % ORDER.length],
      Home: ORDER[0],
      End: ORDER[ORDER.length - 1],
    }[e.key];
    if (!target) return;
    e.preventDefault();
    tabRefs.current.get(target)?.focus();
  };

  // Fades whichever end has tabs scrolled out past it - with the scrollbar
  // hidden, that is the only sign there are more.
  const fade = overflow.start || overflow.end
    ? `linear-gradient(to right, ${overflow.start ? 'transparent, #000 40px' : '#000'}, ${
        overflow.end ? '#000 calc(100% - 40px), transparent' : '#000'
      })`
    : undefined;

  return (
    // The hairline is an inset shadow, not a border, so the underline can sit
    // on top of it - a border would put the underline a pixel above the line.
    <div className={cn('relative bg-white/60 shadow-[inset_0_-1px_0_hsl(var(--border))]', className)}>
      <div
        ref={listRef}
        role="tablist"
        aria-label="What the main pane shows"
        onScroll={updateOverflow}
        // Six tabs do not fit a phone, so the strip scrolls rather than
        // squeezing the labels out. The padding is the pane's own less the
        // tab's, so the first label lines up with the content below.
        className="relative flex h-full items-stretch overflow-x-auto overscroll-x-contain px-1 [scrollbar-width:none] lg:px-3 [&::-webkit-scrollbar]:hidden"
        style={{ maskImage: fade, WebkitMaskImage: fade }}
      >
        {GROUPS.map((group, g) => (
          <div key={g} role="presentation" className="flex shrink-0 items-stretch">
            {g > 0 && (
              <span aria-hidden="true" className="mx-2 h-4 w-px shrink-0 self-center bg-border" />
            )}
            {group.map(({ id, label, icon: Icon }) => {
              const active = mode === id;
              const count = counts?.[id];
              return (
                <button
                  key={id}
                  ref={(el) => {
                    if (el) tabRefs.current.set(id, el);
                    else tabRefs.current.delete(id);
                  }}
                  id={`hub-tab-${id}`}
                  role="tab"
                  type="button"
                  aria-selected={active}
                  aria-controls={active ? panelId : undefined}
                  tabIndex={active ? 0 : -1}
                  onClick={() => onChange(id)}
                  onKeyDown={(e) => onKeyDown(e, id)}
                  className={cn(
                    'group relative isolate flex shrink-0 items-center gap-2 whitespace-nowrap px-3 text-sm font-medium outline-none transition-colors duration-200',
                    active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {/* The hover wash and the focus ring, on a pill inside the
                      tab so they stay off the hairline - the tab itself is the
                      bar's full height, for the hit area. */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute inset-x-0.5 inset-y-2 -z-10 rounded-lg transition-colors duration-200 group-focus-visible:ring-2 group-focus-visible:ring-ring/50',
                      !active && 'group-hover:bg-foreground/[0.045]',
                    )}
                  />
                  <Icon
                    className={cn(
                      'h-4 w-4 shrink-0 transition-colors duration-200',
                      active ? 'text-primary' : 'text-muted-foreground/80 group-hover:text-foreground',
                    )}
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  {label}
                  {count !== undefined && count > 0 && (
                    <span
                      className={cn(
                        'min-w-[1.25rem] rounded-full px-1.5 py-[3px] text-center text-[11px] font-semibold leading-none tabular-nums transition-colors duration-200',
                        active ? 'bg-primary/10 text-primary' : 'bg-foreground/[0.06] text-muted-foreground',
                      )}
                    >
                      {count > 999 ? '999+' : count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}

        {indicator && (
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute bottom-0 left-0 h-0.5 rounded-full bg-primary',
              animate && 'transition-[transform,width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none',
            )}
            style={{ width: indicator.width, transform: `translateX(${indicator.left}px)` }}
          />
        )}
      </div>
    </div>
  );
};
