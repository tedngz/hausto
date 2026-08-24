import { useEffect, useState } from 'react';

/**
 * Matches a CSS media query in JS.
 *
 * Reach for this only when a breakpoint has to change what is MOUNTED rather
 * than what is visible - the hub's chat is one component that must exist in
 * exactly one place, so Tailwind's `hidden`/`lg:flex` (which keeps both in the
 * tree) would give it two conversations. Anything purely visual stays in CSS.
 */
export const useMediaQuery = (query: string): boolean => {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
};
