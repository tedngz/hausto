/**
 * Geometry the hub's floating surfaces share.
 *
 * The hub reserves two edges a normal page does not: the chat rail down the
 * right at xl and up, and the chat dock along the bottom below it. Anything
 * that floats - compare bars, non-modal panels - has to stay clear of whichever
 * one is present, or it covers the chat it exists to be asked about.
 *
 * ⚠️ Every class here is written out IN FULL, deliberately. Tailwind scans
 * source text for complete class names, so a class built by interpolation
 * (`xl:left-[calc(50%-${RAIL}/2)]`) is never seen and silently emits no CSS -
 * the element then falls back to viewport centring and drifts under the rail.
 *
 * The rail's WIDTH is the one thing not written out here: it comes from the
 * --hub-rail custom property (src/index.css), which Hub.tsx applies to the
 * rail itself. The class text stays literal, so Tailwind still sees it, while
 * the number has a single home - copying it into both files is exactly how
 * they drifted apart, leaving these panels centred on a rail 22px narrower
 * than the real one at 1440px, and 285px narrower at 2560px, where the cap
 * below also let a panel run under the rail it is meant to clear.
 */

/**
 * Horizontally centred on the MAIN PANE rather than the viewport: at xl the
 * rail takes the right-hand side, so a viewport-centred element drifts under
 * it. Below xl there is no rail and plain centring is correct.
 */
export const HUB_PANE_CENTRED =
  'left-1/2 -translate-x-1/2 xl:left-[calc(50%-var(--hub-rail)/2)]';

/**
 * Positioning for a non-modal panel (property preview, compare, complex
 * profile) inside the hub.
 *
 * Below xl it is anchored ABOVE the chat dock instead of centred on the
 * viewport - centred, it covered the dock completely, so the one thing the
 * panel exists to allow (asking about what you are looking at) became
 * unreachable. At xl it centres on the main pane and is capped to its width.
 *
 * The `!` matters: DialogContent's own `top-[50%] translate-y-[-50%]` is not
 * reliably beaten by a plain override, and a half-overridden panel hangs off
 * the top of the screen.
 */
export const HUB_PANEL_POSITION = [
  // Below xl: sit above the 64px dock, and never grow past the space left.
  '!top-auto !bottom-20 !translate-y-0 max-h-[calc(100dvh-7rem)]',
  // xl and up: the dock is gone, the rail is not.
  'xl:!top-1/2 xl:!bottom-auto xl:!-translate-y-1/2 xl:max-h-[85dvh]',
  'xl:left-[calc(50%-var(--hub-rail)/2)]',
  'xl:max-w-[calc(100vw-var(--hub-rail)-6rem)]',
].join(' ');
