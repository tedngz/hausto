// Crawl something now, outside the rotation: chosen districts, or buildings
// searched by name. Replaces "Crawl External Listings" and "Project-Targeted
// Crawl", which saved through crawl-external-properties - a path that put
// listings live with no image floor, no interior gate and no vibe queue, and
// left no telemetry.
//
// Every target here is one call to scheduled-crawl `crawl-target`, which saves
// exactly as the rotation does and records a `crawl_runs` row, so what this
// adds shows up in Crawl activity like any other run. Targets run one at a
// time from the browser, since a run can take two minutes.

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, Globe, Loader2, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { HCMC_APARTMENT_PROJECTS, groupProjectsByDistrict } from '@/data/hcmcApartmentProjects';
import { AGENCY_FEEDS, useCrawlStatus, VERDICT_LABEL } from '@/lib/crawlAdmin';

type Target = { marketplace: string; location: string; project?: string };
type Result = Target & { ok: boolean; text: string; written: number };

const projectKey = (p: { district: string; name: string }) => `${p.district}|${p.name}`;

export const CrawlNowPanel = () => {
  const queryClient = useQueryClient();
  const { data: status } = useCrawlStatus();
  const locations = status?.locations ?? [];
  const allSources = status?.marketplaces ?? [];
  const searchable = allSources.filter((s) => !AGENCY_FEEDS.has(s));

  const [mode, setMode] = useState<'districts' | 'buildings'>('districts');
  const [districts, setDistricts] = useState<Set<string>>(new Set());
  const [projects, setProjects] = useState<Set<string>>(new Set());
  const [projectSearch, setProjectSearch] = useState('');
  const [sources, setSources] = useState<Set<string>>(new Set(['batdongsan', 'nhatot']));
  const [maxResults, setMaxResults] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const [results, setResults] = useState<Result[]>([]);

  const effMax = maxResults ?? status?.config.maxListingsPerRun ?? 5;
  const modeSources = mode === 'buildings' ? searchable : allSources;
  const chosenSources = modeSources.filter((s) => sources.has(s));

  const targets: Target[] = useMemo(() => {
    if (mode === 'districts') {
      return [...districts].flatMap((location) => chosenSources.map((marketplace) => ({ marketplace, location })));
    }
    return HCMC_APARTMENT_PROJECTS
      .filter((p) => projects.has(projectKey(p)))
      .flatMap((p) => chosenSources.map((marketplace) => ({ marketplace, location: p.district, project: p.name })));
  }, [mode, districts, projects, chosenSources]);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, key: string, on?: boolean) => {
    const next = new Set(set);
    if (on ?? !next.has(key)) next.add(key); else next.delete(key);
    setter(next);
  };

  const run = async () => {
    if (targets.length === 0) return;
    setRunning(true);
    setResults([]);
    const done: Result[] = [];
    try {
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        const label = `${t.project ? `${t.project} · ` : ''}${t.location} on ${t.marketplace}`;
        setProgress({ done: i, total: targets.length, current: label });
        let result: Result;
        try {
          const { data, error } = await supabase.functions.invoke('scheduled-crawl', {
            body: { action: 'crawl-target', ...t, maxResults: effMax },
          });
          if (error) throw error;
          if (!data?.success) throw new Error(data?.error || 'Not run');
          const s = data.summary;
          result = {
            ...t,
            ok: s.healthy !== false,
            written: s.newListings ?? 0,
            text: `seen ${s.attempted}, +${s.newListings} new, ${s.duplicatesSkipped} held, ${s.filtered} rejected - ${VERDICT_LABEL[s.verdict] ?? s.verdict}`,
          };
        } catch (e) {
          result = { ...t, ok: false, written: 0, text: (e as Error).message };
        }
        // A target refused for Firecrawl budget fails at once, without a
        // scrape, so the loop carries on: the agency feeds never need credits.
        done.push(result);
        setResults([...done]);
      }
      const added = done.reduce((n, r) => n + r.written, 0);
      toast.success(`Crawl finished: ${added} new listing${added === 1 ? '' : 's'}`, {
        description: 'New listings stay hidden until the vibe queue passes them.',
      });
    } finally {
      setRunning(false);
      setProgress(null);
      queryClient.invalidateQueries({ queryKey: ['crawl-runs'] });
      queryClient.invalidateQueries({ queryKey: ['crawl-status'] });
      queryClient.invalidateQueries({ queryKey: ['newest-listings'] });
    }
  };

  const q = projectSearch.toLowerCase().trim();

  return (
    <Card>
      <CardHeader className="px-4 md:px-6">
        <CardTitle className="flex items-center gap-2 text-base md:text-lg">
          <Globe className="h-5 w-5" />
          Crawl now
        </CardTitle>
        <CardDescription className="text-xs md:text-sm">
          Crawl chosen districts or buildings straight away, through the same gates and Firecrawl budget as the
          schedule. Runs even while the schedule is paused.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4 md:px-6 space-y-4">
        <Tabs value={mode} onValueChange={(v) => setMode(v as 'districts' | 'buildings')}>
          <TabsList>
            <TabsTrigger value="districts"><MapPin className="h-3.5 w-3.5 mr-1" /> Districts</TabsTrigger>
            <TabsTrigger value="buildings"><Building2 className="h-3.5 w-3.5 mr-1" /> Buildings</TabsTrigger>
          </TabsList>

          <TabsContent value="districts" className="mt-3 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Districts ({districts.size})</Label>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-xs"
                onClick={() => setDistricts(districts.size === locations.length ? new Set() : new Set(locations))}
              >
                {districts.size === locations.length ? 'Clear' : 'All'}
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {locations.map((loc) => (
                <Chip key={loc} on={districts.has(loc)} onClick={() => toggle(districts, setDistricts, loc)}>{loc}</Chip>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="buildings" className="mt-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs">Buildings ({projects.size})</Label>
              <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setProjects(new Set())} disabled={projects.size === 0}>
                Clear
              </Button>
            </div>
            <Input
              placeholder="Filter buildings (Vinhomes, Masteri, Thao Dien)..."
              value={projectSearch}
              onChange={(e) => setProjectSearch(e.target.value)}
            />
            <div className="max-h-64 overflow-y-auto rounded-md border p-2 space-y-2">
              {Object.entries(groupProjectsByDistrict()).map(([district, list]) => {
                const visible = list.filter((p) =>
                  !q || p.name.toLowerCase().includes(q) || p.district.toLowerCase().includes(q)
                  || (p.aliases ?? []).some((a) => a.toLowerCase().includes(q)));
                if (visible.length === 0) return null;
                return (
                  <div key={district}>
                    <div className="text-[11px] font-semibold uppercase text-muted-foreground">{district}</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                      {visible.map((p) => {
                        const key = projectKey(p);
                        return (
                          <label key={key} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted/50">
                            <Checkbox checked={projects.has(key)} onCheckedChange={(c) => toggle(projects, setProjects, key, !!c)} />
                            <span className="truncate">{p.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              The building's name is the search term. Agency feeds cannot be searched by name, so they are not offered
              here.
            </p>
          </TabsContent>
        </Tabs>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-xs">Sources</Label>
            <div className="flex flex-wrap gap-1.5">
              {modeSources.map((s) => (
                <Chip key={s} on={sources.has(s)} onClick={() => toggle(sources, setSources, s)}>
                  {s}{AGENCY_FEEDS.has(s) && <span className="opacity-70"> · feed</span>}
                </Chip>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Max new listings per target</Label>
              <span className="text-xs font-bold text-primary">{effMax}</span>
            </div>
            <Slider value={[effMax]} onValueChange={(v) => setMaxResults(v[0])} min={1} max={10} step={1} />
            <p className="text-xs text-muted-foreground">
              batdongsan and housingsgn spend a Firecrawl credit per listing ({status?.firecrawl.left ?? '?'} left today).
            </p>
          </div>
        </div>

        <Button onClick={run} disabled={running || targets.length === 0} className="w-full">
          {running
            ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Crawling...</>
            : <>Crawl {targets.length} target{targets.length === 1 ? '' : 's'}</>}
        </Button>

        {progress && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span>{progress.done + 1} of {progress.total}</span>
              <span className="truncate ml-2 text-muted-foreground">{progress.current}</span>
            </div>
            <Progress value={(progress.done / progress.total) * 100} className="h-1.5" />
          </div>
        )}

        {results.length > 0 && (
          <div className="rounded-md border divide-y text-xs">
            {results.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 px-2 py-1.5">
                <Badge variant="secondary" className="text-[10px]">{r.marketplace}</Badge>
                <span className="font-medium">{r.project ? `${r.project} · ` : ''}{r.location}</span>
                <span className={cn('ml-auto', r.ok ? 'text-muted-foreground' : 'text-destructive')}>{r.text}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const Chip = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      'rounded-full px-2.5 py-1 text-xs border transition-colors',
      on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border text-muted-foreground hover:border-primary/50',
    )}
  >
    {children}
  </button>
);
