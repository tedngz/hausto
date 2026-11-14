/**
 * Publishes the height of the visible page as `--app-h`, for the one-screen
 * layouts (the hub, a listing's page, the full-screen dialogs) to size against
 * instead of `100dvh`.
 *
 * Brave on iOS does not keep 100dvh in step with what it shows. With its tab
 * strip and bottom toolbar up it can come out well short of the screen, so a
 * page that is exactly 100dvh tall ends a few rows above the toolbar, the chat
 * bar floating over a blank band of page. window.innerHeight is the height
 * WebKit is actually showing, so it is right where dvh is not, and it does not
 * shrink for the on-screen keyboard (ChatDock pins the sheet to the visual
 * viewport for that).
 *
 * The default in index.css is 100dvh, so anything rendered before this runs,
 * or without it, is no worse than before.
 */
export const trackAppHeight = () => {
  const root = document.documentElement;
  let last = -1;
  const update = () => {
    const h = window.innerHeight;
    if (h === last || h <= 0) return;
    last = h;
    root.style.setProperty('--app-h', `${h}px`);
  };
  update();
  // A toolbar folding away and a rotation both resize the window. Not the
  // visual viewport: a pinch-zoom resizes that, and is no reason to re-lay
  // the page out.
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', () => window.setTimeout(update, 250));
  // iOS restores a page from its back-forward cache with the height it had
  // when it left, which may not be the toolbar state it comes back to.
  window.addEventListener('pageshow', update);
};
