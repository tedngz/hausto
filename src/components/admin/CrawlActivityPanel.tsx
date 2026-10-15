// What the crawler has actually done, from `crawl_runs` - one row per run,
// written by scheduled-crawl for the rotation and for on-demand crawls alike.
//
// This replaces a view that guessed at runs by clustering
// `external_properties.crawled_at` timestamps, which could only see runs that
// stored something: a source rejecting every candidate, or a run that died,
// looked exactly like a quiet day. Those are the runs worth seeing.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Eye, Image as ImageIcon, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { withAdminSources } from '@/lib/adminListingSources';
import {
  runDied, shortAge, timeAgo, useCrawlRuns, useCrawlStatus, VERDICT_LABEL, type CrawlRun,
} from '@/lib/crawlAdmin';

const DAY = 86400_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ListingRow = any;

export const CrawlActivityPanel = ({ onPreview }: { onPreview: (row: ListingRow) => void }) => {
  const { data: status } = useCrawlStatus();
  const { data: runs, isLoading, refetch, isFetching } = useCrawlRuns();

  return (
    <Card>
      <CardHeader className="px-4 md:px-6">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base md:text-lg">
              <Activity className="h-5 w-5" />
              Crawl activity
            </CardTitle>
            <CardDescription className="text-xs md:text-sm">
              Every run of the last 14 days, scheduled or on demand, with what it found and how it was judged.
            </CardDescription>
          </div>
          <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-4 md:px-6">
        {isLoading || !runs ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <Tabs defaultValue="sources">
            <TabsList className="h-auto flex-wrap justify-start">
              <TabsTrigger value="sources">By source</TabsTrigger>
              <TabsTrigger value="coverage">District coverage</TabsTrigger>
              <TabsTrigger value="runs">Recent runs</TabsTrigger>
              <TabsTrigger value="listings">Newest listings</TabsTrigger>
            </TabsList>
            <TabsContent value="sources" className="mt-3">
              <SourceSummary runs={runs} sources={status?.marketplaces ?? []} />
            </TabsContent>
            <TabsContent value="coverage" className="mt-3">
              <CoverageGrid
                runs={runs}
                locations={status?.locations ?? []}
                sources={status?.config.enabledMarketplaces ?? status?.marketplaces ?? []}
              />
            </TabsContent>
            <TabsContent value="runs" className="mt-3">
              <RecentRuns runs={runs} />
            </TabsContent>
            <TabsContent value="listings" className="mt-3">
              <NewestListings onPreview={onPreview} />
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
};

/** One line per source: the last 7 days, and whether it is still seeing anything. */
const SourceSummary = ({ runs, sources }: { runs: CrawlRun[]; sources: string[] }) => {
  const { data: active } = useQuery({
    queryKey: ['active-by-source'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('external_properties')
        .select('source, city')
        .eq('is_active', true);
      if (error) throw error;
      const counts: Record<string, { hcmc: number; other: number }> = {};
      for (const r of data ?? []) {
        const c = (counts[r.source] ??= { hcmc: 0, other: 0 });
        if (r.city === 'ho_chi_minh') c.hcmc++; else c.other++;
      }
      return counts;
    },
    refetchInterval: 120_000,
  });

  const week = runs.filter((r) => Date.now() - new Date(r.started_at).getTime() < 7 * DAY);
  const all = [...new Set([...sources, ...week.map((r) => r.source), ...Object.keys(active ?? {})])];
  const totalActive = Object.values(active ?? {}).reduce((n, c) => n + c.hcmc + c.other, 0);

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr className="text-left">
              <th className="px-2 py-1.5 font-medium">Source</th>
              <th className="px-2 py-1.5 font-medium text-right">Live</th>
              <th className="px-2 py-1.5 font-medium text-right" title="Runs in the last 7 days">Runs 7d</th>
              <th className="px-2 py-1.5 font-medium text-right">Seen</th>
              <th className="px-2 py-1.5 font-medium text-right">New</th>
              <th className="px-2 py-1.5 font-medium text-right" title="Already in the index">Held</th>
              <th className="px-2 py-1.5 font-medium text-right">Rejected</th>
              <th className="px-2 py-1.5 font-medium text-right" title="Judged unhealthy, or died before finishing">Problems</th>
              <th className="px-2 py-1.5 font-medium text-right">Last run</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {all.map((source) => {
              const rs = week.filter((r) => r.source === source);
              const sum = (k: keyof CrawlRun) => rs.reduce((n, r) => n + (Number(r[k]) || 0), 0);
              const problems = rs.filter((r) => runDied(r) || (r.finished_at && !r.healthy)).length;
              const last = runs.find((r) => r.source === source);
              const live = active?.[source];
              const disabled = !sources.includes(source);
              return (
                <tr key={source} className={cn(disabled && 'text-muted-foreground')}>
                  <td className="px-2 py-1.5 font-medium">
                    {source}
                    {disabled && <span className="ml-1 text-[10px]">(not crawled)</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right" title={live?.other ? `${live.other} outside HCMC` : undefined}>
                    {live ? live.hcmc + live.other : 0}
                  </td>
                  <td className="px-2 py-1.5 text-right">{rs.length}</td>
                  <td className="px-2 py-1.5 text-right">{sum('attempted')}</td>
                  <td className="px-2 py-1.5 text-right font-semibold text-primary">{sum('written')}</td>
                  <td className="px-2 py-1.5 text-right">{sum('duplicates')}</td>
                  <td className="px-2 py-1.5 text-right">{sum('rejected')}</td>
                  <td className={cn('px-2 py-1.5 text-right', problems > 0 && 'font-semibold text-destructive')}>{problems}</td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">{last ? timeAgo(last.started_at) : 'never'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        {totalActive} listings live. "Held" means the source showed listings the index already has - most of any page
        once a district has been crawled. A run that never finished timed out or was killed mid-crawl.
      </p>
    </div>
  );
};

/**
 * Districts down, sources across: when each combo was last crawled. The
 * rotation should keep every cell within one rotation's age; a cell that falls
 * behind is a combo the scheduler keeps passing over.
 */
const CoverageGrid = ({ runs, locations, sources }: { runs: CrawlRun[]; locations: string[]; sources: string[] }) => {
  const latest = useMemo(() => {
    const m = new Map<string, CrawlRun>();
    for (const r of runs) {
      const key = `${r.location}|${r.source}`;
      if (!m.has(key)) m.set(key, r);
    }
    return m;
  }, [runs]);

  const tone = (r: CrawlRun | undefined) => {
    if (!r) return 'bg-muted text-muted-foreground';
    if (runDied(r)) return 'bg-destructive/15 text-destructive';
    const age = Date.now() - new Date(r.started_at).getTime();
    if (age < 1.5 * DAY) return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400';
    if (age < 3 * DAY) return 'bg-amber-500/15 text-amber-700 dark:text-amber-400';
    return 'bg-destructive/10 text-destructive';
  };

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">District</th>
              {sources.map((s) => <th key={s} className="px-1 py-1.5 font-medium">{s}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y">
            {locations.map((loc) => (
              <tr key={loc}>
                <td className="px-2 py-1 font-medium whitespace-nowrap">{loc}</td>
                {sources.map((s) => {
                  const r = latest.get(`${loc}|${s}`);
                  return (
                    <td key={s} className="px-1 py-1 text-center">
                      <span
                        className={cn('inline-block min-w-[3.5rem] rounded px-1.5 py-0.5 whitespace-nowrap', tone(r))}
                        title={r
                          ? `${new Date(r.started_at).toLocaleString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh' })} - seen ${r.attempted}, new ${r.written}, held ${r.duplicates}, rejected ${r.rejected}${runDied(r) ? ' - died' : ''}`
                          : 'Not crawled in the last 14 days'}
                      >
                        {r ? shortAge(r.started_at) : '-'}
                        {r && runDied(r) && ' died'}
                        {r && r.written > 0 && <span className="font-semibold"> +{r.written}</span>}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Time since each combo was last crawled, with new listings it added. Green is under 36h, amber under 3 days,
        red older - or a run that died before finishing.
      </p>
    </div>
  );
};

const RecentRuns = ({ runs }: { runs: CrawlRun[] }) => (
  <div className="max-h-96 overflow-y-auto rounded-md border divide-y">
    {runs.slice(0, 40).map((r) => {
      const died = runDied(r);
      const topReason = Object.entries(r.reasons ?? {}).sort((a, b) => b[1] - a[1])[0];
      return (
        <div key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5 text-xs">
          <span className="w-16 shrink-0 text-muted-foreground">{timeAgo(r.started_at)}</span>
          <Badge variant="secondary" className="text-[10px]">{r.source}</Badge>
          <span className="min-w-0 flex-1 truncate">{r.location ?? '?'}</span>
          {r.finished_at ? (
            <span className="text-muted-foreground whitespace-nowrap">
              seen {r.attempted} · <span className="font-semibold text-primary">+{r.written}</span> · held {r.duplicates} · rej {r.rejected}
            </span>
          ) : null}
          {died ? (
            <Badge variant="destructive" className="text-[10px]">Died</Badge>
          ) : !r.finished_at ? (
            <Badge variant="outline" className="text-[10px]">Running</Badge>
          ) : (
            <Badge
              variant={r.healthy ? 'outline' : 'destructive'}
              className="text-[10px]"
              title={topReason ? `Top rejection: ${topReason[0]} (${topReason[1]})` : undefined}
            >
              {VERDICT_LABEL[r.verdict ?? ''] ?? r.verdict ?? '?'}
            </Badge>
          )}
        </div>
      );
    })}
    {runs.length === 0 && <p className="p-3 text-center text-xs text-muted-foreground">No runs in the last 14 days.</p>}
  </div>
);

/** The newest rows the crawlers stored, live or still waiting on the vibe queue. */
const NewestListings = ({ onPreview }: { onPreview: (row: ListingRow) => void }) => {
  const { data, isLoading } = useQuery({
    queryKey: ['newest-listings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('external_properties')
        .select('id, title, location, price, price_vnd, images, vibe_analysis, vibe_status, highlights, amenities, source, city, created_at, is_active, size, rooms, deactivated_at')
        .order('created_at', { ascending: false })
        .limit(25);
      if (error) throw error;
      const rows = await withAdminSources(data ?? []);
      if (rows.length === 0) return rows;
      const { data: contacts } = await supabase.rpc('get_external_property_contacts', { _property_ids: rows.map((r) => r.id) });
      const byId = new Map<string, ListingRow>((contacts ?? []).map((c: ListingRow) => [c.id, c]));
      return rows.map((r) => ({
        ...r,
        contact_name: byId.get(r.id)?.contact_name ?? null,
        contact_phone: byId.get(r.id)?.contact_phone ?? null,
      }));
    },
    refetchInterval: 60_000,
  });

  if (isLoading) return <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  const state = (r: ListingRow): { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' } => {
    if (r.is_active) return { label: 'Live', variant: 'default' };
    if (r.deactivated_at) return { label: 'Removed', variant: 'destructive' };
    if (r.vibe_status && r.vibe_status !== 'complete') return { label: `Vibe ${String(r.vibe_status).toLowerCase()}`, variant: 'secondary' };
    return { label: 'Hidden', variant: 'outline' };
  };

  return (
    <div className="max-h-96 overflow-y-auto space-y-1.5">
      {(data ?? []).map((r: ListingRow) => {
        const s = state(r);
        const vnd = Number(r.price_vnd) || 0;
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => onPreview(r)}
            className="flex w-full items-center gap-2 rounded border p-1.5 text-left text-xs hover:border-primary/50 transition-colors"
          >
            {r.images?.[0] ? (
              <img src={r.images[0]} alt="" loading="lazy" className="h-10 w-14 shrink-0 rounded object-cover" />
            ) : (
              <div className="flex h-10 w-14 shrink-0 items-center justify-center rounded bg-muted">
                <ImageIcon className="h-4 w-4 text-muted-foreground/40" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{r.title}</p>
              <p className="truncate text-muted-foreground">
                {r.source} · {timeAgo(r.created_at)} · {vnd ? `${(vnd / 1e6).toFixed(1)}M ₫` : 'no price'} · {r.images?.length ?? 0} photos
              </p>
            </div>
            <Badge variant={s.variant} className="shrink-0 text-[10px]">{s.label}</Badge>
            <Eye className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        );
      })}
    </div>
  );
};
