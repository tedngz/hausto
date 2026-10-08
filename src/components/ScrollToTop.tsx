import { useLayoutEffect } from 'react';

/**
 * Opens the page it is rendered on at the top. The router leaves the window
 * where it was, so a page reached from the landing page's footer otherwise
 * opens about as far down as the footer was - near the end of a policy, with
 * its first sections above the fold. Before paint, so there is no jump.
 */
export const ScrollToTop = () => {
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  return null;
};
