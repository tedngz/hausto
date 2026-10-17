import { useCallback, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useBrowseListings, type BrowseRow } from '@/hooks/useBrowseListings';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { locationMatchesDistrict } from '@/utils/districts';
import { normalizeSize } from '@/lib/preferences';

// How far back the "new" window reaches. Without it a first visit would open on
// every listing we have ever crawled, and a renter who last pressed "Mark all
// seen" weeks ago would read "new since" a date long past.
export const NEW_WINDOW_DAYS = 7;
const MAX_SHOWN = 8;

const seenKey = (userId: string) => `hubListingsSeen_${userId}`;

const readSeenAt = (userId?: string): number => {
  const floor = Date.now() - NEW_WINDOW_DAYS * 86_400_000;
  if (!userId) return floor;
  try {
    const raw = localStorage.getItem(seenKey(userId));
    const parsed = raw ? Date.parse(raw) : NaN;
    return Number.isNaN(parsed) ? floor : Math.max(parsed, floor);
  } catch {
    return floor;
  }
};

/** Does this listing's room count answer what the renter said they wanted? */
const matchesSize = (row: BrowseRow, size: string): boolean => {
  const rooms = (row.rooms || '').toLowerCase();
  if (!rooms) return true; // unknown shouldn't disqualify a fresh listing
  if (size === 'studio') return rooms.includes('studio');
  if (size === '3br+') return /[3-9]/.test(rooms);
  if (size === '1br') return rooms.includes('1');
  if (size === '2br') return rooms.includes('2');
  return true;
};

/**
 * Listings the crawler has seen for the first time since this renter last
 * looked, narrowed to what they actually asked for.
 *
 * Reads the shared listing cache rather than fetching - on the hub the browse
 * table has usually already pulled it, so the strip costs nothing. "Seen" is a
 * per-device timestamp for now; moving it onto user_preferences is what would
 * let this drive an email digest later.
 */
export const useNewListings = () => {
  const { user } = useAuth();
  const { preferences } = useUserPreferences();
  // Deliberately the unfiltered set, which is the key the browse table starts
  // on - one fetch serves both.
  const { rows, loading } = useBrowseListings({ city: 'all', minBudget: '', maxBudget: '' });

  const [seenAt, setSeenAt] = useState(() => readSeenAt(user?.id));

  const listings = useMemo(() => {
    const districts = preferences?.location ?? [];
    const [minVnd, maxVnd] = preferences?.priceRange ?? [0, 0];
    const size = normalizeSize(preferences?.size);

    return rows
      .filter((r) => {
        const listedAt = r.listed_at ? Date.parse(r.listed_at) : NaN;
        if (Number.isNaN(listedAt) || listedAt <= seenAt) return false;
        if (districts.length > 0 && !districts.some((d) => locationMatchesDistrict(r.location, d))) {
          return false;
        }
        if (maxVnd > 0 && r.price_vnd) {
          if (r.price_vnd < minVnd || r.price_vnd > maxVnd) return false;
        }
        if (size && !matchesSize(r, size)) return false;
        return true;
      })
      .sort((a, b) => Date.parse(b.listed_at) - Date.parse(a.listed_at));
  }, [rows, seenAt, preferences]);

  const markAllSeen = useCallback(() => {
    const now = new Date();
    if (user?.id) {
      try {
        localStorage.setItem(seenKey(user.id), now.toISOString());
      } catch {
        // Non-fatal: the strip just reappears next visit.
      }
    }
    setSeenAt(now.getTime());
  }, [user?.id]);

  return {
    listings: listings.slice(0, MAX_SHOWN),
    total: listings.length,
    /** Whether the renter's saved preferences actually narrowed this. */
    isScoped: (preferences?.location?.length ?? 0) > 0 || !!normalizeSize(preferences?.size),
    seenAt,
    loading,
    markAllSeen,
  };
};
