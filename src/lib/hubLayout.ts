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
 * Below xl it lives in the band between the top bar and the chat dock, rather
 * than centred on the viewport. Centred, it covered both: the dock, so the one
 * thing the panel exists to allow (asking about what you are looking at)
 * became unreachable, and the nav, so there was no way back out of the page
 * while a panel was up. Anchored to the dock and capped by the nav, it clears
 * both - and because --hub-dock tracks the chat's CURRENT height, the panel
 * lifts as the sheet opens rather than disappearing behind it.
 *
 * Only the bottom is anchored, deliberately. Pinning top AND bottom makes a
 * fixed element stretch to fill the band whatever its content, and a
 * transparent panel that big swallows taps on the table behind it.
 *
 * At xl it centres on the main pane and is capped to its width.
 *
 * The `!` matters: DialogContent's own `top-[50%] translate-y-[-50%]` is not
 * reliably beaten by a plain override, and a half-overridden panel hangs off
 * the top of the screen. The same goes for max-height, which callers also set.
 */
export const HUB_PANEL_POSITION = [
  // Below xl: sit above the chat, and never grow up into the nav bar.
  '!top-auto !bottom-[calc(var(--hub-dock)+1rem)] !translate-y-0',
  '!max-h-[calc(100dvh-var(--hub-nav)-var(--hub-dock)-2rem)]',
  // xl and up: the dock is gone, the rail is not.
  'xl:!top-[calc(50%+var(--hub-nav)/2)] xl:!bottom-auto xl:!-translate-y-1/2 xl:!max-h-[calc(100dvh-var(--hub-nav)-2rem)]',
  'xl:left-[calc(50%-var(--hub-rail)/2)]',
  'xl:max-w-[calc(100vw-var(--hub-rail)-6rem)]',
].join(' ');
