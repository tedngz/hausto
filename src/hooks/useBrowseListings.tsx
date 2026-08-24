import { useQuery, useQueryClient } from '@tanstack/react-query';

// Public listing data from public-property-search (no contact details).
const SEARCH_URL = 'https://gbgrwjdmytaksrztcyzs.supabase.co/functions/v1/public-property-search';
const PAGE_SIZE = 50; // API max per request
const MAX_ROWS = 1000; // safety cap; paging stops when the API runs dry

export type BrowseRow = {
  id: string;
  title: string;
  url: string;
  source_url?: string;
  location: string;
  price_vnd: number | null;
  price_usd: number | null;
  rooms: string | null;
  size: string | null;
  vibe: string | null;
  images: string[];
  highlights?: string[];
  amenities?: string[];
  /** vibe_analysis.styles from the AI analysis - drives the Style match group */
  style_tags?: string[];
  /** Per-image AI highlight strings, indexed to images - the detailed captions */
  image_highlights?: string[];
  description?: string | null;
  source: string;
  /** When the crawler first saw this listing - what "new" is measured against */
  listed_at: string;
  last_verified_at?: string | null;
  posting_count?: number;
};

export interface BrowseFilters {
  city: string;
  minBudget: string;
  maxBudget: string;
}

export const browseListingsKey = ({ city, minBudget, maxBudget }: BrowseFilters) =>
  ['browse-listings', city, minBudget, maxBudget] as const;

/**
 * The verified-listings set, fetched once per filter combination and shared.
 *
 * The browse table and the hub's new-listings strip are two views of the same
 * inventory; before this they would have been two full paged fetches, and the
 * strip would have had to settle for whatever the first page happened to hold
 * (which is not the newest - the API returns realtor listings ahead of crawled
 * ones, each ordered independently).
 */
export const useBrowseListings = (filters: BrowseFilters) => {
  const queryClient = useQueryClient();
  const queryKey = browseListingsKey(filters);

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<BrowseRow[]> => {
      const collected: BrowseRow[] = [];
      const params = new URLSearchParams();
      if (filters.city !== 'all') params.set('city', filters.city);
      if (filters.minBudget && Number(filters.minBudget) > 0) params.set('min_budget', filters.minBudget);
      if (filters.maxBudget && Number(filters.maxBudget) > 0) params.set('max_budget', filters.maxBudget);
      params.set('limit', String(PAGE_SIZE));

      for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
        params.set('offset', String(offset));
        let page: BrowseRow[];
        try {
          const res = await fetch(`${SEARCH_URL}?${params}`);
          if (!res.ok) throw new Error(`Search failed (${res.status})`);
          page = (await res.json()).results || [];
        } catch (e) {
          // A later page failing shouldn't blank out rows already on screen -
          // only fail the query outright when we got nothing at all.
          if (collected.length > 0) break;
          throw e;
        }
        collected.push(...page);
        // Publish each page as it lands rather than holding the whole table
        // behind one spinner for up to 20 serial requests. The resolved value
        // below replaces this with the same (complete) array.
        queryClient.setQueryData(queryKey, [...collected]);
        if (page.length < PAGE_SIZE) break;
      }
      return collected;
    },
  });

  return {
    rows: query.data ?? [],
    // Data arriving mid-flight (above) clears this, so the table starts drawing
    // as soon as the first page is in.
    loading: query.isPending,
    error: query.isError ? (query.error as Error).message : null,
  };
};
