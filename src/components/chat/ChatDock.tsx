import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { ASSISTANT_COMPARE_EVENT } from '@/lib/assistantEvents';
import { markChatDockPointerDown } from '@/lib/hubLayout';

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
 * lose. 1280 is the first width where a usable rail (340px) and the full table
 * (about 830 + 48 padding) both fit without either one scrolling sideways. Under it,
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

// Fields that bring up the on-screen keyboard. A disabled one does not, which
// matters: sending disables the composer, and it can still hold focus.
const KEYBOARD_FIELDS =
  'textarea:enabled:not([readonly]), select:enabled, ' +
  'input:enabled:not([readonly]):not([type=button]):not([type=checkbox]):not([type=file])' +
  ':not([type=image]):not([type=radio]):not([type=range]):not([type=reset]):not([type=submit])';

const wantsKeyboard = () => {
  const el = document.activeElement;
  return el instanceof HTMLElement && (el.isContentEditable || el.matches(KEYBOARD_FIELDS));
};

// How much of the visible page has to vanish while a field has focus before it
// counts as an on-screen keyboard. A phone's takes 250px and more; a browser
// toolbar folding away, or the shortcut bar over a hardware keyboard, less.
const KEYBOARD_MIN_PX = 150;

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
  /** The sheet is fixed to the bottom of the screen and the page scrolls
   *  behind it, rather than closing a one-screen layout. A listing's page
   *  uses it: on Brave for iOS no measure of the screen's height (100dvh,
   *  window.innerHeight) reliably matched what it showed, and a page sized by
   *  one ended above the toolbar with blank page under the chat. The bottom
   *  edge of the screen is the one thing a fixed element always finds. The
   *  page has to leave --hub-dock of room at its end so its last line can be
   *  scrolled clear of the sheet. */
  pinned?: boolean;
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
  pinned = false,
  onHeaderPortalChange,
  children,
}: ChatDockProps) => {
  // How tall the renter has dragged the sheet, in px. Null means "the default
  // third of the viewport" - kept distinct so a rotation or a resize re-reads
  // the default rather than freezing yesterday's pixels.
  const [dockHeight, setDockHeight] = useState<number | null>(null);
  // Suppresses the height transition mid-drag, which would otherwise lag the finger.
  const [dragging, setDragging] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  // Where the visible page is while the keyboard is up (see below); null otherwise.
  const [keyboardFrame, setKeyboardFrame] = useState<{ top: number; height: number } | null>(null);

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

  // The page under the sheet is one screen tall (--app-h) and its panes
  // scroll themselves, so the window should never move. iOS moves it anyway:
  // focusing the composer, it scrolls the window to lift the field clear of
  // the keyboard, and when the keyboard goes - sending disables the field,
  // which dismisses it - it can leave the window where it put it. The page
  // then sits a keyboard too high, its nav cut off at the top and a blank band
  // under the composer where the sheet should meet the bottom of the screen.
  // So once nothing wants the keyboard, the window goes back to the top. The
  // check waits for scrolling and the keyboard to settle, so it never fights
  // a finger or the keyboard's own animation.
  // A pinned sheet sits over a page that scrolls, so it leaves the window be.
  useEffect(() => {
    if (hasRail || pinned) return;
    const viewport = window.visualViewport;
    let timer: number | undefined;
    const settle = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        // A pinch-zoom pans the window too, and is the renter's to undo.
        if (wantsKeyboard() || (viewport && viewport.scale > 1.01)) return;
        if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
      }, 150);
    };
    window.addEventListener('scroll', settle, { passive: true });
    window.addEventListener('focusout', settle);
    viewport?.addEventListener('resize', settle);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('scroll', settle);
      window.removeEventListener('focusout', settle);
      viewport?.removeEventListener('resize', settle);
    };
  }, [hasRail, pinned]);

  // While the keyboard is up for a field in the sheet, the sheet is pinned over
  // exactly the part of the page the renter can see: from the top of the
  // visual viewport down to the keyboard. Left in the page's flow it was at
  // the mercy of how each browser makes room for a keyboard - Brave on iOS
  // shrinks 100dvh but not the document, so the page ended a hand's width
  // above the keyboard, slicing through the composer, with blank page below
  // it to scroll into. The visual viewport is the one measure every browser
  // agrees on. So while the renter types the sheet is the whole screen - the
  // thread, then the composer sitting on the keyboard - and it goes back into
  // the page when the keyboard goes.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (hasRail || !viewport) return;
    // How tall the visible page is with no keyboard, re-read whenever nothing
    // wants one, so a resized window or a folded toolbar is not mistaken for it.
    let restHeight = viewport.height;
    const measure = () => {
      const typing = wantsKeyboard();
      if (!typing) restHeight = viewport.height;
      const up =
        typing &&
        !!sheetRef.current?.contains(document.activeElement) &&
        viewport.height < restHeight - KEYBOARD_MIN_PX;
      const top = Math.round(viewport.offsetTop);
      const height = Math.round(viewport.height);
      setKeyboardFrame((prev) =>
        !up ? null : prev && prev.top === top && prev.height === height ? prev : { top, height },
      );
    };
    // Focus moves before activeElement settles, and before the keyboard starts
    // to rise; the viewport's own events carry the rest.
    let timer: number | undefined;
    const measureSoon = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(measure, 0);
    };
    viewport.addEventListener('resize', measure);
    viewport.addEventListener('scroll', measure);
    document.addEventListener('focusin', measureSoon);
    document.addEventListener('focusout', measureSoon);
    return () => {
      window.clearTimeout(timer);
      viewport.removeEventListener('resize', measure);
      viewport.removeEventListener('scroll', measure);
      document.removeEventListener('focusin', measureSoon);
      document.removeEventListener('focusout', measureSoon);
      setKeyboardFrame(null);
    };
  }, [hasRail]);

  // How much of the bottom edge the chat is taking, published for the floating
  // panels (see lib/hubLayout). They are portaled to the body and cannot
  // measure this page, and a panel that assumed the collapsed height simply
  // vanished behind the sheet the moment the renter opened it.
  useEffect(() => {
    const root = document.documentElement;
    const openHeight = dockHeight === null ? 'max(calc(var(--app-h) * 0.5), 15rem)' : `${dockHeight}px`;
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
      // About a quarter of the viewport, so the browse table fits beside it.
      // The width is --hub-rail (src/index.css): every floating surface
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
    // That puts it over modal dialogs too - Extensive search, a viewing
    // request, the Pass - which switch the rest of the page off
    // (pointer-events: none on the body). pointer-events-auto keeps the sheet
    // working, so the renter can fold it down to see the dialog it covers.
    // Marking the pointerdown (and data-chat-dock, for focus) tells the
    // dialog a tap here is not a tap outside it (components/ui/dialog.tsx).
    <div
      ref={sheetRef}
      data-chat-dock
      onPointerDownCapture={(e) => markChatDockPointerDown(e.nativeEvent)}
      className={
        hidden
          ? 'hidden'
          : `pointer-events-auto z-[60] ${
              keyboardFrame ? 'fixed inset-x-0' : pinned ? 'fixed inset-x-0 bottom-0' : 'shrink-0'
            }`
      }
      style={keyboardFrame ? { top: keyboardFrame.top } : undefined}
    >
      <div
        className={`glass-card flex flex-col rounded-t-3xl ${
          dragging || keyboardFrame ? '' : 'transition-[height] duration-200'
        }`}
        // A third of the viewport by default, not two thirds: on a phone the
        // dock used to bury whatever the renter was asking about, so the answer
        // arrived with no way to see what it referred to. A Deep scan is longer
        // than that third, though, so the renter can drag it taller - up to
        // 85dvh - and the choice sticks.
        // Pinned, it also goes opaque: it covers the listings then, instead of
        // sitting beneath them, and their text showing through the glass
        // competed with the conversation.
        style={{
          height: keyboardFrame
            ? `${keyboardFrame.height}px`
            : isOpen
              ? dockHeight === null
                ? 'max(calc(var(--app-h) * 0.5), 15rem)'
                : `${dockHeight}px`
              : '4rem',
          backgroundColor: keyboardFrame ? 'hsl(var(--background))' : undefined,
        }}
      >
        {/* Grabber. Only while the sheet is open: collapsed, there is nothing
            to resize and the whole bar is already a toggle. Nor while it is
            pinned over the keyboard, where its height is the screen's. */}
        {isOpen && !keyboardFrame && (
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
