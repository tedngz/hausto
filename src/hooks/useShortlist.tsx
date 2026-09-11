// The renter's shortlist: 3 to 5 listings they want to view.
//
// Kept in localStorage rather than in a table. A shortlist is a draft, and a
// draft that costs a round trip to add to is a draft nobody builds; it becomes
// durable when it becomes a request, which is the point at which it means
// something. CLAUDE.md scopes renter auth to a phone-keyed session, so there is
// no account to hang it off until then anyway.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export const MIN_SHORTLIST = 3;
export const MAX_SHORTLIST = 5;

const STORAGE_KEY = 'hausto.shortlist.v1';

export interface ShortlistEntry {
  listingId: string;
  title: string;
  priceVnd: number | null;
  districtCode: string | null;
  imageUrl: string | null;
  addedAt: string;
}

interface ShortlistApi {
  entries: ShortlistEntry[];
  has: (listingId: string) => boolean;
  toggle: (entry: Omit<ShortlistEntry, 'addedAt'>) => { ok: boolean; error?: string };
  remove: (listingId: string) => void;
  clear: () => void;
  isFull: boolean;
  canSubmit: boolean;
}

const ShortlistContext = createContext<ShortlistApi | null>(null);

function read(): ShortlistEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // Trust nothing that came out of storage: a stale or hand-edited value must
    // degrade to an empty shortlist, never to a crash on first render.
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e: ShortlistEntry) => e && typeof e.listingId === 'string').slice(0, MAX_SHORTLIST);
  } catch {
    return [];
  }
}

export function ShortlistProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<ShortlistEntry[]>(read);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // Private mode, or a full quota. Losing the shortlist is survivable;
      // failing the render is not.
    }
  }, [entries]);

  const has = useCallback(
    (listingId: string) => entries.some(e => e.listingId === listingId),
    [entries],
  );

  const remove = useCallback((listingId: string) => {
    setEntries(prev => prev.filter(e => e.listingId !== listingId));
  }, []);

  const toggle = useCallback((entry: Omit<ShortlistEntry, 'addedAt'>) => {
    let result: { ok: boolean; error?: string } = { ok: true };
    setEntries(prev => {
      if (prev.some(e => e.listingId === entry.listingId)) {
        return prev.filter(e => e.listingId !== entry.listingId);
      }
      if (prev.length >= MAX_SHORTLIST) {
        // The cap is not arbitrary: more than five cannot be viewed in one day,
        // and an itinerary is one day.
        result = { ok: false, error: `You can request up to ${MAX_SHORTLIST} viewings at a time.` };
        return prev;
      }
      return [...prev, { ...entry, addedAt: new Date().toISOString() }];
    });
    return result;
  }, []);

  const clear = useCallback(() => setEntries([]), []);

  const value = useMemo<ShortlistApi>(() => ({
    entries,
    has,
    toggle,
    remove,
    clear,
    isFull: entries.length >= MAX_SHORTLIST,
    canSubmit: entries.length >= MIN_SHORTLIST,
  }), [entries, has, toggle, remove, clear]);

  return <ShortlistContext.Provider value={value}>{children}</ShortlistContext.Provider>;
}

export function useShortlist(): ShortlistApi {
  const ctx = useContext(ShortlistContext);
  if (!ctx) throw new Error('useShortlist must be used inside a ShortlistProvider');
  return ctx;
}
