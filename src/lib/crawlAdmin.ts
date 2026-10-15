import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// What the admin page's crawl panels share: the scheduler's own view of the
// rotation (`scheduled-crawl` action `status`), the run telemetry in
// `crawl_runs`, and how both are shown.
//
// The districts and sources are read from the function rather than listed
// here, so the page cannot drift from what the cron actually crawls - it did:
// the old coverage tracker still counted Hanoi and Da Nang a week after they
// left the rotation.

export interface CrawlConfig {
  paused: boolean;
  frequencyMinutes: number;
  maxListingsPerRun: number;
  minPriceVnd?: number;
  enabledMarketplaces?: string[];
  configStorageError?: string;
}

export interface CrawlStatus {
  config: CrawlConfig;
  locations: string[];
  marketplaces: string[];
  spend: { source: string; used: number; cap: number; agencyFeed: boolean }[];
  firecrawl: { left: number; daily: number };
  cronMinutes: number;
}

export function useCrawlStatus() {
  return useQuery({
    queryKey: ['crawl-status'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('scheduled-crawl', { body: { action: 'status' } });
      if (error) throw error;
      return data as CrawlStatus;
    },
    refetchInterval: 30_000,
  });
}

export interface CrawlRun {
  id: string;
  source: string;
  location: string | null;
  started_at: string;
  finished_at: string | null;
  attempted: number;
  written: number;
  updated: number;
  duplicates: number;
  rejected: number;
  healthy: boolean;
  verdict: string | null;
  error: string | null;
  reasons: Record<string, number> | null;
}

/** The last two weeks of runs: long enough to cover a rotation twice over. */
export function useCrawlRuns() {
  return useQuery({
    queryKey: ['crawl-runs'],
    queryFn: async () => {
      const since = new Date(Date.now() - 14 * 86400_000).toISOString();
      const { data, error } = await supabase
        .from('crawl_runs')
        .select('id, source, location, started_at, finished_at, attempted, written, updated, duplicates, rejected, healthy, verdict, error, reasons')
        .gte('started_at', since)
        .order('started_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as CrawlRun[];
    },
    refetchInterval: 60_000,
  });
}

/** Sources read from an agency's own feed: no search by building, no Firecrawl. */
export const AGENCY_FEEDS = new Set(['rentapartment', 'vnrenthome', 'jhouse']);

export const SOURCE_SITE: Record<string, string> = {
  batdongsan: 'batdongsan.com.vn',
  nhatot: 'nhatot.com',
  housingsgn: 'housingsgn.com',
  rentapartment: 'rentapartment.vn',
  vnrenthome: 'vnrenthome.com',
  jhouse: 'jhouse.vn',
};

export function timeAgo(timestamp: string | number | null | undefined): string {
  if (timestamp === null || timestamp === undefined) return 'never';
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Compact age for a grid cell: hours up to three days, so 25h and 40h - either
 *  side of a rotation - do not both read "1d". */
export function shortAge(timestamp: string): string {
  const mins = Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000);
  if (mins < 60) return `${Math.max(0, mins)}m`;
  const hours = Math.floor(mins / 60);
  return hours < 72 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  return `${Math.round((minutes / 60) * 10) / 10}h`;
}

export function formatVndM(vnd: number): string {
  return `${Math.round((vnd / 1e6) * 10) / 10}M ₫`;
}

/**
 * How long one pass over every district x source takes. The cron crawls one
 * combo per call, so this - not the cooldown - is what paces a source; the
 * cooldown only decides whether a due combo is skipped (scheduled-crawl's
 * DEFAULT_CONFIG comment has the arithmetic).
 */
export function rotationMinutes(status: CrawlStatus, enabled: string[]): number {
  return status.locations.length * Math.max(1, enabled.length) * status.cronMinutes;
}

export const VERDICT_LABEL: Record<string, string> = {
  OK: 'OK',
  NOTHING_ATTEMPTED: 'Nothing found',
  ALL_REJECTED: 'All rejected',
  DOMINANT_REJECTION: 'One reason dominates',
  NOTHING_WRITTEN: 'Nothing new',
};

/** A run with no finish time an hour after it started died mid-crawl. */
export function runDied(run: CrawlRun): boolean {
  return !run.finished_at && Date.now() - new Date(run.started_at).getTime() > 3600_000;
}
