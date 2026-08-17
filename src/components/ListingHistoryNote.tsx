import { TrendingDown, TrendingUp, CalendarClock, RotateCcw } from 'lucide-react';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useListingPriceHistory } from '@/hooks/useListingHistory';

// What we know about a single listing over time. This works at n=1 — it makes
// no claim about the wider market — so it needs no sample-size threshold, unlike
// the building-level bands.

interface ListingHistoryNoteProps {
  listingId: string;
  /** Only crawled listings have snapshot history. */
  enabled: boolean;
  /** When the listing first entered our index — not the first snapshot. */
  firstSeenAt?: string | null;
  isRelist?: boolean;
}

const DAYS_BEFORE_WORTH_SAYING = 14;

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

export function ListingHistoryNote({
  listingId,
  enabled,
  firstSeenAt,
  isRelist,
}: ListingHistoryNoteProps) {
  const { formatPrice } = useCurrency();
  const { data } = useListingPriceHistory(listingId, enabled);

  if (!enabled) return null;

  const latestMove = data?.latestMove ?? null;
  const moveCount = data?.moves.length ?? 0;
  const days = daysSince(firstSeenAt);
  const showDays = days !== null && days >= DAYS_BEFORE_WORTH_SAYING;

  if (!latestMove && !showDays && !isRelist) return null;

  const dropped = latestMove ? latestMove.pctChange < 0 : false;
  const pct = latestMove ? Math.abs(latestMove.pctChange) : 0;

  return (
    <div className="mt-4 max-w-[760px] mx-auto rounded-xl border border-border/60 bg-white/70 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
        What we've seen on this listing
      </p>
      <ul className="space-y-1.5 text-sm">
        {latestMove && (
          <li className="flex items-start gap-2">
            {dropped ? (
              <TrendingDown className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
            ) : (
              <TrendingUp className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
            )}
            <span>
              Asking {dropped ? 'dropped' : 'rose'}{' '}
              <span className="font-semibold">{pct.toFixed(0)}%</span> to{' '}
              <span className="font-semibold">{formatPrice(latestMove.to)}</span> on{' '}
              {formatWhen(latestMove.at)}
              {moveCount > 1 && (
                <span className="text-muted-foreground">
                  {' '}· {moveCount} price changes since we started tracking it
                </span>
              )}
            </span>
          </li>
        )}

        {showDays && (
          <li className="flex items-start gap-2">
            <CalendarClock className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>
              We've tracked this listing for <span className="font-semibold">{days} days</span>
            </span>
          </li>
        )}

        {isRelist && (
          <li className="flex items-start gap-2">
            <RotateCcw className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>This unit was on the market before under an earlier posting</span>
          </li>
        )}
      </ul>
    </div>
  );
}
