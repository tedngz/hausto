import { useNavigate } from 'react-router-dom';
import { Check, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useNewListings } from '@/hooks/useNewListings';
import { districtOf } from '@/utils/districts';

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "2h ago" / "yesterday" - short enough for a corner chip. */
const firstSeenLabel = (iso: string): string => {
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return 'new';
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  return RELATIVE.format(-Math.floor(hours / 24), 'day');
};

/** "since Tuesday" / "since 3 March" - what the count is counting from. */
const sinceLabel = (seenAt: number): string => {
  const days = Math.floor((Date.now() - seenAt) / 86_400_000);
  if (days < 1) return 'since earlier today';
  if (days === 1) return 'since yesterday';
  if (days < 7) {
    return `since ${new Date(seenAt).toLocaleDateString('en-US', { weekday: 'long' })}`;
  }
  return `since ${new Date(seenAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}`;
};

/**
 * What the crawler has turned up since this renter last looked. Sits above the
 * main pane because it is the one thing on the hub that is time-sensitive -
 * everything else is still there tomorrow.
 */
export const HubNewListings = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { listings, total, isScoped, seenAt, loading, markAllSeen } = useNewListings();

  // "New since you last looked" needs a last-looked, which needs an account.
  if (!user || loading || listings.length === 0) return null;

  return (
    <section aria-label="New listings">
      <div className="mb-2.5 flex items-center gap-2.5">
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
        </span>
        <span className="text-sm font-semibold">
          {total} new {sinceLabel(seenAt)}
        </span>
        <span className="hidden truncate text-xs text-muted-foreground md:inline">
          {isScoped
            ? 'first seen by the crawler, inside what you asked for'
            : 'first seen by the crawler'}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-11 shrink-0 px-2 text-xs text-muted-foreground sm:h-9"
          onClick={markAllSeen}
        >
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          Mark all seen
        </Button>
      </div>

      {/* Bleeds off the right edge on narrow screens rather than wrapping */}
      <div className="-mx-4 overflow-x-auto px-4 pb-1 lg:-mx-6 lg:px-6 [scrollbar-width:thin]">
        <div className="flex w-max gap-3">
          {listings.map((r) => (
            <button
              key={r.id}
              onClick={() => navigate(`/property/${r.id}`)}
              className="w-[200px] shrink-0 overflow-hidden rounded-2xl border border-border bg-card text-left shadow-sm transition-colors hover:border-primary/40"
            >
              <div className="relative h-24 bg-foreground">
                {r.images?.[0] && (
                  <img
                    src={r.images[0]}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                )}
                <span className="absolute left-2 top-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                  {firstSeenLabel(r.listed_at)}
                </span>
              </div>
              <div className="flex flex-col gap-1 p-3">
                <h3 className="line-clamp-1 font-serif text-[13px] font-medium leading-tight">{r.title}</h3>
                <span className="line-clamp-1 text-[10.5px] text-muted-foreground">
                  {districtOf(r.location)}
                  {r.size && !/not specified|n\/a|bed/i.test(r.size) ? ` · ${r.size}` : ''}
                </span>
                <span className="font-serif text-sm font-semibold">
                  {r.price_usd ? `$${r.price_usd.toLocaleString()}` : '-'}
                  <span className="text-[10.5px] font-normal text-muted-foreground"> /mo</span>
                </span>
              </div>
            </button>
          ))}

          {total > listings.length && (
            <div className="flex w-[110px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-border text-xs text-muted-foreground">
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
              {total - listings.length} more
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
