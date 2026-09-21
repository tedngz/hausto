import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { ASSISTANT_COMPARE_EVENT } from '@/lib/assistantEvents';

/**
 * The Hausto Agent's shell: a rail on the side at desktop widths, a draggable
 * bottom sheet below them.
 *
 * Lifted out of the hub so the same chat has the same shape wherever it is
 * docked. A listing's page needs it too - the conversation there is about the
 * listing on screen - and a second hand-rolled sheet would have been a second
 * set of drag maths, a second breakpoint and a second answer to "how tall is
 * the dock" for the floating panels that read `--hub-dock`.
 *
 * It owns the chrome and the geometry only. The conversation is the child, so
 * a page can pass whatever HomeAI it needs - and, crucially, only one of the
 * rail and the sheet is ever mounted, so the chat is never duplicated.
 */

/**
 * Below this the page does not split into two panes at all.
 *
 * The comparison table has a hard 760px minimum, and a chat rail narrow enough
 * to fit beside it at 1024px is too cramped to hold a conversation - both panes
 * lose. 1280 is the first width where a usable rail (400px) and the full table
 * (760 + 48 padding) both fit without either one scrolling sideways. Under it,
 * the chat docks as a sheet and the main pane gets the whole width.
 *
 * Matches Tailwind's `xl`, which is what the breakpoint utilities use.
 */
export const RAIL_MIN_VIEWPORT = 1280;

// The dock's default, floor and ceiling, in px against the current viewport.
// The floor is the composer plus one line of reply; below that the sheet is
// open but useless. The ceiling leaves enough of the pane behind it to see
// what the conversation is about.
const DOCK_MIN_PX = 240;
const dockDefaultPx = () => Math.max(Math.round(window.innerHeight * 0.5), DOCK_MIN_PX);
const dockMaxPx = () => Math.round(window.innerHeight * 0.85);

interface ChatDockProps {
  /** True at rail widths. The caller measures it, so a page can force the
   *  sheet (a narrow layout on a wide screen) without lying about the viewport. */
  hasRail: boolean;
  /** Hides both shapes without unmounting the chat inside - the hub's profile
   *  detour, where a chat rail beside a billing page is one more thing to
   *  ignore, but the thread and the draft should survive the way back. */
  hidden?: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shown beside the title while the sheet is collapsed. */
  collapsedHint?: string;
  /** Receives the node the chat's own controls (history, new chat) portal into,
   *  so they share the title's row instead of taking one off the thread. */
  onHeaderPortalChange: (el: HTMLDivElement | null) => void;
  children: ReactNode;
}

export const ChatDock = ({
  hasRail,
  hidden = false,
  isOpen,
  onOpenChange,
  collapsedHint,
  onHeaderPortalChange,
  children,
}: ChatDockProps) => {
  // How tall the renter has dragged the sheet, in px. Null means "the default
  // third of the viewport" - kept distinct so a rotation or a resize re-reads
  // the default rather than freezing yesterday's pixels.
  const [dockHeight, setDockHeight] = useState<number | null>(null);
  // Suppresses the height transition mid-drag, which would otherwise lag the finger.
  const [dragging, setDragging] = useState(false);

  // Dragging the grabber resizes the sheet. Pointer events rather than touch
  // events so the same handler serves a finger, a stylus and a mouse; capture
  // keeps the drag alive when the finger slides off the 40px handle.
  const startDockDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isOpen) return;
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = dockHeight ?? dockDefaultPx();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    setDragging(true);
    const onMove = (ev: PointerEvent) => {
      // Up is taller: the sheet grows from the bottom edge.
      const next = startHeight + (startY - ev.clientY);
      setDockHeight(Math.min(Math.max(next, DOCK_MIN_PX), dockMaxPx()));
    };
    const onUp = () => {
      setDragging(false);
      el.releasePointerCapture(e.pointerId);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  };

  // The same resize from the keyboard, since a drag handle nobody can tab to
  // is a control half the renters do not have.
  const nudgeDock = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowUp' ? 48 : e.key === 'ArrowDown' ? -48 : 0;
    if (!step) return;
    e.preventDefault();
    setDockHeight((h) =>
      Math.min(Math.max((h ?? dockDefaultPx()) + step, DOCK_MIN_PX), dockMaxPx()),
    );
  };

  // Re-clamp a dragged height when the viewport changes, so a rotation cannot
  // leave the dock taller than the screen.
  useEffect(() => {
    if (dockHeight === null) return;
    const onResize = () => setDockHeight((h) => (h === null ? h : Math.min(h, dockMaxPx())));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [dockHeight]);

  // Auto-expand the dock to half the screen when a compare is triggered on mobile.
  useEffect(() => {
    if (hasRail) return;
    const onCompare = () => {
      setDockHeight(Math.round(window.innerHeight * 0.5));
    };
    window.addEventListener(ASSISTANT_COMPARE_EVENT, onCompare);
    return () => window.removeEventListener(ASSISTANT_COMPARE_EVENT, onCompare);
  }, [hasRail]);

  // How much of the bottom edge the chat is taking, published for the floating
  // panels (see lib/hubLayout). They are portaled to the body and cannot
  // measure this page, and a panel that assumed the collapsed height simply
  // vanished behind the sheet the moment the renter opened it.
  useEffect(() => {
    const root = document.documentElement;
    const openHeight = dockHeight === null ? 'max(50dvh, 15rem)' : `${dockHeight}px`;
    root.style.setProperty(
      '--hub-dock',
      hasRail || hidden ? '0px' : isOpen ? openHeight : '4rem',
    );
    // The variable belongs to whichever page is docking the chat, not the app:
    // leaving it set would push every other page's dialogs up off a dock that
    // isn't there.
    return () => {
      root.style.removeProperty('--hub-dock');
    };
  }, [hasRail, hidden, isOpen, dockHeight]);

  if (hasRail) {
    return (
      // A third of the viewport, the same share the sheet takes on a phone or
      // tablet. The width is --hub-rail (src/index.css): every floating surface
      // positions itself against the same value, and it used to be spelled out
      // in two files that disagreed.
      <aside
        className={`w-[var(--hub-rail)] shrink-0 flex-col border-l border-border bg-white/70 backdrop-blur-xl ${
          hidden ? 'hidden' : 'flex'
        }`}
      >
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
          <span className="font-serif text-base">Hausto Agent</span>
          <div ref={onHeaderPortalChange} className="ml-auto flex items-center gap-1" />
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </aside>
    );
  }

  return (
    // z-[60], not z-50: a panel portaled to the body is later in the document
    // than this dock, so at an equal z-index the panel wins and the chat opens
    // behind it.
    <div
      className={hidden ? 'hidden' : 'z-[60] shrink-0'}
    >
      <div
        className={`glass-card flex flex-col rounded-t-3xl ${dragging ? '' : 'transition-[height] duration-200'}`}
        // A third of the viewport by default, not two thirds: on a phone the
        // dock used to bury whatever the renter was asking about, so the answer
        // arrived with no way to see what it referred to. A Deep Scan is longer
        // than that third, though, so the renter can drag it taller - up to
        // 85dvh - and the choice sticks.
        style={{
          height: isOpen
            ? dockHeight === null
              ? 'max(50dvh, 15rem)'
              : `${dockHeight}px`
            : '4rem',
        }}
      >
        {/* Grabber. Only while the sheet is open: collapsed, there is nothing
            to resize and the whole bar is already a toggle. */}
        {isOpen && (
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize the chat"
            tabIndex={0}
            onPointerDown={startDockDrag}
            onKeyDown={nudgeDock}
            onDoubleClick={() => setDockHeight(null)}
            className="flex h-4 shrink-0 cursor-ns-resize touch-none items-end justify-center pb-1 focus-visible:outline-none"
          >
            <span className="h-1 w-10 rounded-full bg-border" />
          </div>
        )}
        <div className="flex h-16 shrink-0 items-center gap-2 px-4">
          <button
            className="flex min-w-0 flex-1 items-center gap-3 self-stretch text-left"
            aria-expanded={isOpen}
            aria-controls="hausto-chat-dock"
            onClick={() => onOpenChange(!isOpen)}
          >
            <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="font-serif text-base">Hausto Agent</span>
            {!isOpen && collapsedHint && (
              <span className="truncate text-xs text-muted-foreground">{collapsedHint}</span>
            )}
            {isOpen ? (
              <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            ) : (
              <ChevronUp className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
          </button>
          {/* Only while the sheet is open: collapsed, these would act on a
              thread nobody can see. Unclaimed, the chat keeps them in its own
              (hidden) header rather than dropping them. */}
          {isOpen && (
            <div ref={onHeaderPortalChange} className="flex shrink-0 items-center gap-1" />
          )}
        </div>

        {/* Collapsing hides the chat, it never unmounts it - tearing down
            HomeAI would take the conversation, the draft and the current
            results with it. */}
        <div id="hausto-chat-dock" className={`min-h-0 flex-1 ${isOpen ? '' : 'hidden'}`}>
          {children}
        </div>
      </div>
    </div>
  );
};
