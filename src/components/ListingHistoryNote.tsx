import { useQuery } from '@tanstack/react-query';
import { TrendingDown, TrendingUp, CalendarClock, RotateCcw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useListingPriceHistory } from '@/hooks/useListingHistory';
import { cn } from '@/lib/utils';

// What we know about a single listing over time. This works at n=1 — it makes
// no claim about the wider market — so it needs no sample-size threshold, unlike
// the building-level bands.
//
// Part of the Deep Scan since 2026-10-08 (owner's decision): price moves, days
// on the market and a relist are intel the Pass sells, so this renders inside
// the scan's read - which titles it - rather than under every listing.

interface ListingHistoryNoteProps {
  listingId: string;
  /** Only crawled listings have snapshot history. */
  enabled: boolean;
  className?: string;
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

/** When the listing first entered our index (not its first snapshot), and whether it is a relist. */
function useListingFacts(listingId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['listing-history-facts', listingId],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from('external_properties').select('created_at, is_relist').eq('id', listingId).maybeSingle();
      const row = data as { created_at?: string | null; is_relist?: boolean | null } | null;
      return { firstSeenAt: row?.created_at ?? null, isRelist: !!row?.is_relist };
    },
  });
}

/** Whether there is anything to say - so a host can leave out its heading when there is not. */
// eslint-disable-next-line react-refresh/only-export-components
export function useHasListingHistory(listingId: string, enabled: boolean): boolean {
  const { data } = useListingPriceHistory(listingId, enabled);
  const { data: facts } = useListingFacts(listingId, enabled);
  const days = daysSince(facts?.firstSeenAt);
  return enabled && (!!data?.latestMove || (days !== null && days >= DAYS_BEFORE_WORTH_SAYING) || !!facts?.isRelist);
}

export function ListingHistoryNote({ listingId, enabled, className }: ListingHistoryNoteProps) {
  const { formatPrice } = useCurrency();
  const { data } = useListingPriceHistory(listingId, enabled);
  const { data: facts } = useListingFacts(listingId, enabled);

  if (!enabled) return null;

  const latestMove = data?.latestMove ?? null;
  const moveCount = data?.moves.length ?? 0;
  const days = daysSince(facts?.firstSeenAt);
  const showDays = days !== null && days >= DAYS_BEFORE_WORTH_SAYING;
  const isRelist = !!facts?.isRelist;

  if (!latestMove && !showDays && !isRelist) return null;

  const dropped = latestMove ? latestMove.pctChange < 0 : false;
  const pct = latestMove ? Math.abs(latestMove.pctChange) : 0;

  return (
    <ul className={cn('space-y-1.5 text-sm', className)}>
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
  );
}
