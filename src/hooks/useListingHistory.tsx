import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// Price history for a crawled listing, read from external_property_snapshots.
// Snapshots are append-on-change, so every row here is a real observed change
// rather than one row per crawl.
//
// Note on "how long have we seen this": that comes from the listing's own
// created_at, NOT from the earliest snapshot. The backfill timestamped each
// seeded snapshot at the crawl that produced the row's current state, so for a
// recently recrawled listing the earliest snapshot is days old even though we
// have tracked the listing for months.

export interface PriceMove {
  from: number;
  to: number;
  at: string;
  pctChange: number; // negative = the asking price came down
}

export interface PriceHistory {
  moves: PriceMove[];
  latestMove: PriceMove | null;
}

export interface SnapshotRow {
  observed_at: string;
  price: number | string | null;
}

/** Pure derivation, exported so the arithmetic can be tested without a DB. */
export function derivePriceHistory(rows: SnapshotRow[]): PriceHistory {
  const moves: PriceMove[] = [];
  let prev: number | null = null;

  for (const row of rows) {
    const price = Number(row.price) || 0;
    if (price <= 0) continue;
    if (prev !== null && price !== prev) {
      moves.push({
        from: prev,
        to: price,
        at: row.observed_at,
        pctChange: ((price - prev) / prev) * 100,
      });
    }
    prev = price;
  }

  return { moves, latestMove: moves.length > 0 ? moves[moves.length - 1] : null };
}

export function useListingPriceHistory(listingId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['listing-history', listingId],
    enabled: !!listingId && enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<PriceHistory> => {
      const { data, error } = await supabase
        .from('external_property_snapshots')
        .select('observed_at, price')
        .eq('listing_id', listingId!)
        .order('observed_at', { ascending: true })
        .limit(200);
      if (error) throw error;
      return derivePriceHistory((data ?? []) as SnapshotRow[]);
    },
  });
}
