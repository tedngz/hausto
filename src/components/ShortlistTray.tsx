// The shortlist, always reachable.
//
// A shortlist built across browse, the hub and half a dozen listing pages needs
// somewhere to land, and a renter who has added three listings has no way to
// know that three is the number that unlocks anything. So the bar says where
// they are and what it takes - and says nothing at all when the shortlist is
// empty, which is most of the time.

import { Link, useLocation } from 'react-router-dom';
import { useShortlist, MIN_SHORTLIST, MAX_SHORTLIST } from '@/hooks/useShortlist';
import { Button } from '@/components/ui/button';

export function ShortlistTray() {
  const { entries, canSubmit } = useShortlist();
  const { pathname } = useLocation();

  // Not on the request page itself, which renders the shortlist in full, and
  // not on the mock phone, which is a dev surface.
  if (entries.length === 0) return null;
  if (pathname.startsWith('/viewings/request') || pathname.startsWith('/dev/')) return null;

  const needed = MIN_SHORTLIST - entries.length;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center p-4">
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-full border bg-background/95 px-4 py-2 shadow-lg backdrop-blur">
        <span className="text-sm">
          <strong>{entries.length}</strong> of {MAX_SHORTLIST} shortlisted
        </span>
        <span className="flex-1 truncate text-xs text-muted-foreground">
          {canSubmit ? 'Ready to request' : `Add ${needed} more`}
        </span>
        <Button asChild size="sm" disabled={!canSubmit} variant={canSubmit ? 'default' : 'secondary'}>
          <Link to="/viewings/request">{canSubmit ? 'Request viewings' : 'View'}</Link>
        </Button>
      </div>
    </div>
  );
}
