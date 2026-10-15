// The auto-crawl schedule: what pg_cron's `auto-crawl-v3` does every half hour,
// and the settings it reads from Redis (scheduled-crawl `get-config` /
// `set-config`).
//
// It leads the Listings tab because it is the one control that decides how the
// index grows, and because a setting here can quietly stop it: a cooldown longer
// than one rotation leaves the crawler idle for the difference, and the cron
// still reports success on every skipped call.

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Clock, Loader2, Pause, Play, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import {
  AGENCY_FEEDS, formatMinutes, formatVndM, rotationMinutes, runDied, timeAgo,
  useCrawlRuns, useCrawlStatus, VERDICT_LABEL,
} from '@/lib/crawlAdmin';

export const CrawlSchedulePanel = () => {
  const queryClient = useQueryClient();
  const { data: status, isLoading } = useCrawlStatus();
  const { data: runs } = useCrawlRuns();

  const [frequency, setFrequency] = useState<number | null>(null);
  const [maxListings, setMaxListings] = useState<number | null>(null);
  const [minPrice, setMinPrice] = useState<number | null>(null);
  const [sources, setSources] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [triggering, setTriggering] = useState(false);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['crawl-status'] });
    queryClient.invalidateQueries({ queryKey: ['crawl-runs'] });
  };

  if (isLoading || !status) {
    return (
      <Card>
        <CardContent className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const cfg = status.config;
  const allSources = status.marketplaces;
  const effFrequency = frequency ?? cfg.frequencyMinutes;
  const effMaxListings = maxListings ?? cfg.maxListingsPerRun;
  const effMinPrice = minPrice ?? cfg.minPriceVnd ?? 5_000_000;
  const effSources = sources ?? cfg.enabledMarketplaces ?? allSources;
  const storageError = cfg.configStorageError;
  const paused = cfg.paused;

  const dirty =
    (frequency !== null && frequency !== cfg.frequencyMinutes) ||
    (maxListings !== null && maxListings !== cfg.maxListingsPerRun) ||
    (minPrice !== null && minPrice !== (cfg.minPriceVnd ?? 5_000_000)) ||
    (sources !== null && [...sources].sort().join() !== [...(cfg.enabledMarketplaces ?? allSources)].sort().join());

  const cycle = rotationMinutes(status, effSources);
  const idlePerCycle = effFrequency - cycle;
  const combos = status.locations.length * effSources.length;

  const lastFinished = (runs ?? []).find((r) => r.finished_at);
  const latest = runs?.[0];
  const hoursSinceRun = lastFinished ? (Date.now() - new Date(lastFinished.started_at).getTime()) / 3600_000 : null;
  const stalled = !paused && hoursSinceRun !== null && hoursSinceRun > 2;

  const save = async (patch: Record<string, unknown>) => {
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('scheduled-crawl', { body: { action: 'set-config', ...patch } });
      if (error) throw error;
      if (data?.success === false) throw new Error(data?.storageError || data?.error || 'Config was not saved');
      return data;
    } finally {
      setSaving(false);
      refresh();
    }
  };

  const togglePause = async () => {
    try {
      const data = await save({ paused: !paused });
      toast.success(data?.config?.paused ? 'Auto-crawl paused' : 'Auto-crawl resumed');
    } catch (e) {
      toast.error('Failed to update', { description: (e as Error).message });
    }
  };

  const saveSettings = async () => {
    try {
      await save({
        frequencyMinutes: effFrequency,
        maxListingsPerRun: effMaxListings,
        minPriceVnd: effMinPrice,
        enabledMarketplaces: effSources,
      });
      setFrequency(null); setMaxListings(null); setMinPrice(null); setSources(null);
      toast.success('Crawl settings saved');
    } catch (e) {
      toast.error('Failed to save settings', { description: (e as Error).message });
    }
  };

  // The same call the cron makes: it crawls the most overdue combo, or says
  // why it will not (cooldown, daily caps, Firecrawl budget).
  const runNext = async () => {
    setTriggering(true);
    try {
      const { data, error } = await supabase.functions.invoke('scheduled-crawl', { body: {} });
      if (error) throw error;
      const s = data?.summary;
      if (s) {
        toast.success(`Crawled ${s.target?.location} on ${s.target?.marketplace}`, {
          description: `${s.newListings} new, ${s.duplicatesSkipped} already held, ${s.filtered} rejected - ${VERDICT_LABEL[s.verdict] ?? s.verdict}`,
        });
      } else {
        toast.message('Nothing crawled', { description: data?.message || 'No reason given' });
      }
    } catch (e) {
      toast.error('Failed to trigger crawl', { description: (e as Error).message });
    } finally {
      setTriggering(false);
      refresh();
    }
  };

  return (
    <Card className={cn(paused && 'border-destructive/40')}>
      <CardHeader className="px-4 md:px-6">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base md:text-lg">
              <Clock className="h-5 w-5" />
              Auto-crawl schedule
              {paused
                ? <Badge variant="destructive" className="text-xs">Paused</Badge>
                : <Badge className="text-xs bg-emerald-600 hover:bg-emerald-600">Active</Badge>}
              {storageError && <Badge variant="outline" className="text-xs">Config storage unavailable</Badge>}
            </CardTitle>
            <CardDescription className="mt-1 text-xs md:text-sm">
              Every {status.cronMinutes} min the cron crawls the most overdue of {combos} combos
              ({status.locations.length} HCMC districts x {effSources.length} sources). New listings stay hidden
              until the vibe queue passes them.
            </CardDescription>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button size="sm" variant="outline" onClick={runNext} disabled={triggering || paused}>
              {triggering ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Zap className="h-4 w-4 mr-1" />}
              Run next now
            </Button>
            <Button
              size="sm"
              variant={paused ? 'default' : 'destructive'}
              onClick={togglePause}
              disabled={saving || !!storageError}
            >
              {paused ? <><Play className="h-4 w-4 mr-1" /> Resume</> : <><Pause className="h-4 w-4 mr-1" /> Pause</>}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-4 md:px-6 space-y-4">
        {storageError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            Auto-crawl is held paused because its config in Upstash Redis cannot be read: {storageError}
          </div>
        )}

        {/* Where it stands, at a glance */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Stat
            label="Last run"
            value={latest ? timeAgo(latest.started_at) : 'none'}
            hint={latest
              ? `${latest.source} · ${latest.location ?? '?'}${runDied(latest) ? ' · died' : !latest.finished_at ? ' · running' : latest.verdict ? ` · ${VERDICT_LABEL[latest.verdict] ?? latest.verdict}` : ''}`
              : undefined}
            tone={stalled ? 'warn' : undefined}
          />
          <Stat
            label="One full rotation"
            value={formatMinutes(cycle)}
            hint={`${combos} combos x ${status.cronMinutes} min`}
          />
          <Stat
            label="Firecrawl today"
            value={`${status.firecrawl.left} / ${status.firecrawl.daily} left`}
            hint="batdongsan + housingsgn spend it"
            tone={status.firecrawl.left < 5 ? 'warn' : undefined}
          />
          <Stat
            label="New listings today"
            value={String(status.spend.reduce((n, s) => n + s.used, 0))}
            hint={`cap ${status.spend[0]?.cap ?? '?'} per source`}
          />
        </div>

        {idlePerCycle > 0 && (
          <Warning>
            The cooldown ({formatMinutes(effFrequency)}) is longer than one rotation ({formatMinutes(cycle)}), so after
            each pass the crawler sits idle for about {formatMinutes(idlePerCycle)}, and every cron call in between
            reports "all locations recently crawled". Anything at or under {formatMinutes(cycle)} keeps it running
            continuously.
          </Warning>
        )}
        {stalled && idlePerCycle <= 0 && (
          <Warning>
            No run has finished for {Math.floor(hoursSinceRun!)}h while the schedule is active. "Run next now" shows
            the reason the scheduler gives.
          </Warning>
        )}

        {/* Settings */}
        <div className="rounded-lg border p-3 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <Setting
              label="Cooldown per district x source"
              value={formatMinutes(effFrequency)}
              help={`A combo crawled less than this long ago is skipped. One rotation takes ${formatMinutes(cycle)}.`}
            >
              <Slider value={[effFrequency]} onValueChange={(v) => setFrequency(v[0])} min={30} max={4320} step={30} />
            </Setting>
            <Setting
              label="Max new listings per run"
              value={String(effMaxListings)}
              help="Also capped per source per day and by Firecrawl credits left."
            >
              <Slider value={[effMaxListings]} onValueChange={(v) => setMaxListings(v[0])} min={1} max={10} step={1} />
            </Setting>
            <Setting
              label="Minimum rent"
              value={formatVndM(effMinPrice)}
              help="Listings below this rent are skipped."
            >
              <Slider value={[effMinPrice]} onValueChange={(v) => setMinPrice(v[0])} min={0} max={30_000_000} step={500_000} />
            </Setting>
            <div className="space-y-2">
              <Label className="text-xs">Sources in the rotation</Label>
              <div className="flex flex-wrap gap-1.5">
                {allSources.map((mp) => {
                  const on = effSources.includes(mp);
                  const spent = status.spend.find((s) => s.source === mp);
                  return (
                    <button
                      key={mp}
                      type="button"
                      onClick={() => {
                        const next = on ? effSources.filter((m) => m !== mp) : [...effSources, mp];
                        if (next.length === 0) { toast.error('Keep at least one source'); return; }
                        setSources(next);
                      }}
                      className={cn(
                        'rounded-full px-2.5 py-1 text-xs border transition-colors',
                        on
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background border-border text-muted-foreground hover:border-primary/50',
                      )}
                      title={spent ? `${spent.used}/${spent.cap} new listings today` : undefined}
                    >
                      {mp}
                      {AGENCY_FEEDS.has(mp) && <span className="opacity-70"> · feed</span>}
                      {spent && <span className="opacity-70"> · {spent.used}/{spent.cap}</span>}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                "feed" sources are read from the agency's own data and spend no Firecrawl. The count is today's new
                listings against the daily cap.
              </p>
            </div>
          </div>
          {dirty && (
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setFrequency(null); setMaxListings(null); setMinPrice(null); setSources(null); }}
              >
                Discard
              </Button>
              <Button size="sm" onClick={saveSettings} disabled={saving}>
                {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                Save settings
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

const Stat = ({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'warn' }) => (
  <div className={cn('rounded-md border p-2.5', tone === 'warn' && 'border-amber-500/50 bg-amber-500/5')}>
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className="text-sm font-semibold">{value}</div>
    {hint && <div className="text-[11px] text-muted-foreground truncate" title={hint}>{hint}</div>}
  </div>
);

const Setting = ({ label, value, help, children }: { label: string; value: string; help: string; children: React.ReactNode }) => (
  <div className="space-y-2">
    <div className="flex items-center justify-between">
      <Label className="text-xs">{label}</Label>
      <span className="text-xs font-bold text-primary">{value}</span>
    </div>
    {children}
    <p className="text-xs text-muted-foreground">{help}</p>
  </div>
);

const Warning = ({ children }: { children: React.ReactNode }) => (
  <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
    <p>{children}</p>
  </div>
);
