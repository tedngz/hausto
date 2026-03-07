import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Slider } from "@/components/ui/slider";
import { Loader2, Sparkles, CheckCircle2, XCircle, Search, Globe, ShieldAlert, Clock, Calendar, Activity, RefreshCw, Pause, Play, Settings2, Eye, MapPin, Image as ImageIcon, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

function getTimeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const AdminTools = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [isGenerating, setIsGenerating] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [results, setResults] = useState<{
    processed: number;
    errors: number;
    total: number;
  } | null>(null);
  const [verificationResults, setVerificationResults] = useState<{
    totalProperties: number;
    embeddingsFound: number;
    coveragePercent: number;
    missingEmbeddings: string[];
    totalMissing: number;
    sampleEmbeddings: any[];
  } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [testQuery, setTestQuery] = useState("Modern cozy apartment with natural light and workspace");
  const [testResults, setTestResults] = useState<any>(null);

  // Crawl state
  const [isCrawling, setIsCrawling] = useState(false);
  const [crawlCity, setCrawlCity] = useState<'ho_chi_minh' | 'hanoi' | 'da_nang'>('ho_chi_minh');
  const [crawlMarketplaces, setCrawlMarketplaces] = useState({ batdongsan: true, nhatot: true });
  const [crawlForceRefresh, setCrawlForceRefresh] = useState(false);
  const [crawlRunVibe, setCrawlRunVibe] = useState(true);
  const [crawlResults, setCrawlResults] = useState<any>(null);
  const [crawlMaxListings, setCrawlMaxListings] = useState(10);
  const [crawlProgress, setCrawlProgress] = useState<{ current: number; total: number; location: string } | null>(null);
  const [isManualCrawlTriggering, setIsManualCrawlTriggering] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isBatchReanalyzing, setIsBatchReanalyzing] = useState(false);
  const [batchReanalyzeResults, setBatchReanalyzeResults] = useState<{ total: number; fixed: number; errors: number } | null>(null);

  // State for expanded crawl run
  const [expandedRunIdx, setExpandedRunIdx] = useState<number | null>(null);
  const [expandedRunProperties, setExpandedRunProperties] = useState<any[]>([]);
  const [isLoadingRunProperties, setIsLoadingRunProperties] = useState(false);

  // Fetch crawl schedule config from Redis via scheduled-crawl function
  const { data: crawlConfig, refetch: refetchConfig } = useQuery({
    queryKey: ['crawl-config'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('scheduled-crawl', {
        body: { action: 'get-config' },
      });
      if (error) throw error;
      return data?.config as { paused: boolean; frequencyMinutes: number; maxListingsPerRun: number } | null;
    },
  });

  const [localFrequency, setLocalFrequency] = useState<number | null>(null);
  const [localMaxListings, setLocalMaxListings] = useState<number | null>(null);

  // Sync local state when config loads
  const effectiveFrequency = localFrequency ?? crawlConfig?.frequencyMinutes ?? 240;
  const effectiveMaxListings = localMaxListings ?? crawlConfig?.maxListingsPerRun ?? 10;
  const isPaused = crawlConfig?.paused ?? false;

  const handleTogglePause = useCallback(async () => {
    setIsSavingConfig(true);
    try {
      const { data, error } = await supabase.functions.invoke('scheduled-crawl', {
        body: { action: 'set-config', paused: !isPaused },
      });
      if (error) throw error;
      toast.success(data?.config?.paused ? 'Auto-crawl paused' : 'Auto-crawl resumed');
      refetchConfig();
    } catch (err: any) {
      toast.error('Failed to update config', { description: err.message });
    } finally {
      setIsSavingConfig(false);
    }
  }, [isPaused, refetchConfig]);

  const handleSaveConfig = useCallback(async () => {
    setIsSavingConfig(true);
    try {
      const { error } = await supabase.functions.invoke('scheduled-crawl', {
        body: {
          action: 'set-config',
          frequencyMinutes: effectiveFrequency,
          maxListingsPerRun: effectiveMaxListings,
        },
      });
      if (error) throw error;
      toast.success('Crawl settings saved');
      setLocalFrequency(null);
      setLocalMaxListings(null);
      refetchConfig();
    } catch (err: any) {
      toast.error('Failed to save settings', { description: err.message });
    } finally {
      setIsSavingConfig(false);
    }
  }, [effectiveFrequency, effectiveMaxListings, refetchConfig]);

  const hasUnsavedChanges = (localFrequency !== null && localFrequency !== crawlConfig?.frequencyMinutes) ||
    (localMaxListings !== null && localMaxListings !== crawlConfig?.maxListingsPerRun);

  const { data: crawlActivity, refetch: refetchCrawlActivity } = useQuery({
    queryKey: ['crawl-activity'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('external_properties')
        .select('id, city, source, location_normalized, crawled_at, title, price, is_active')
        .order('crawled_at', { ascending: false })
        .limit(200);
      
      if (error) throw error;
      if (!data || data.length === 0) return [];

      const runs: Array<{
        timestamp: string;
        city: string;
        source: string;
        location: string;
        count: number;
        propertyIds: string[];
      }> = [];

      let currentRun: typeof runs[0] | null = null;

      for (const prop of data) {
        const crawlTime = new Date(prop.crawled_at!).getTime();
        
        if (
          !currentRun ||
          Math.abs(crawlTime - new Date(currentRun.timestamp).getTime()) > 5 * 60 * 1000 ||
          currentRun.source !== prop.source ||
          currentRun.city !== prop.city
        ) {
          currentRun = {
            timestamp: prop.crawled_at!,
            city: prop.city || 'unknown',
            source: prop.source || 'unknown',
            location: prop.location_normalized || 'unknown',
            count: 0,
            propertyIds: [],
          };
          runs.push(currentRun);
        }
        
        currentRun.count++;
        currentRun.propertyIds.push(prop.id);
      }

      return runs.slice(0, 10);
    },
    refetchInterval: 60000,
  });

  // Fetch crawl coverage stats
  const { data: crawlStats } = useQuery({
    queryKey: ['crawl-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('external_properties')
        .select('city, source, is_active')
        .eq('is_active', true);
      
      if (error) throw error;
      
      const stats = {
        total: data?.length || 0,
        byCitySource: {} as Record<string, number>,
      };

      for (const prop of data || []) {
        const key = `${prop.city}/${prop.source}`;
        stats.byCitySource[key] = (stats.byCitySource[key] || 0) + 1;
      }

      return stats;
    },
    refetchInterval: 60000,
  });

  // Fetch per-district crawl coverage
  const { data: districtCoverage } = useQuery({
    queryKey: ['district-coverage'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('external_properties')
        .select('location_normalized, city, source, crawled_at')
        .order('crawled_at', { ascending: false });
      
      if (error) throw error;

      // Build a map of location_normalized -> latest crawl info
      const coverageMap = new Map<string, { city: string; lastCrawled: string; sources: Set<string>; count: number }>();
      
      for (const row of data || []) {
        const key = row.location_normalized || '';
        if (!key) continue;
        const existing = coverageMap.get(key);
        if (!existing) {
          coverageMap.set(key, {
            city: row.city || 'other',
            lastCrawled: row.crawled_at || '',
            sources: new Set([row.source]),
            count: 1,
          });
        } else {
          existing.sources.add(row.source);
          existing.count++;
          if (row.crawled_at && row.crawled_at > existing.lastCrawled) {
            existing.lastCrawled = row.crawled_at;
          }
        }
      }

      return coverageMap;
    },
    refetchInterval: 60000,
  });

  const [previewProperty, setPreviewProperty] = useState<any>(null);

  const handleExpandRun = async (idx: number, propertyIds: string[]) => {
    if (expandedRunIdx === idx) {
      setExpandedRunIdx(null);
      setExpandedRunProperties([]);
      return;
    }
    setExpandedRunIdx(idx);
    setIsLoadingRunProperties(true);
    try {
      const { data, error } = await supabase
        .from('external_properties')
        .select('id, title, location, price, images, vibe, vibe_analysis, highlights, amenities, source, source_url, city, crawled_at, is_active, size, rooms, contact_name, contact_phone')
        .in('id', propertyIds);
      if (error) throw error;
      setExpandedRunProperties(data || []);
    } catch {
      setExpandedRunProperties([]);
    } finally {
      setIsLoadingRunProperties(false);
    }
  };

  const { data: isAdmin, isLoading: isCheckingRole } = useQuery({
    queryKey: ['is-admin', user?.id],
    queryFn: async () => {
      if (!user?.id) return false;
      const { data } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('role', 'admin')
        .maybeSingle();
      return !!data;
    },
    enabled: !!user?.id,
  });

  // Show loading while checking auth/role
  if (authLoading || isCheckingRole) {
    return (
      <div className="container mx-auto p-6 max-w-4xl flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Block access if not authenticated or not admin
  if (!user || !isAdmin) {
    return (
      <div className="container mx-auto p-6 max-w-4xl flex flex-col items-center justify-center min-h-[60vh] text-center gap-4">
        <ShieldAlert className="h-16 w-16 text-destructive" />
        <h1 className="text-2xl font-bold">Access Denied</h1>
        <p className="text-muted-foreground">You don't have permission to access Admin Tools.</p>
        <Button onClick={() => navigate('/')} variant="outline">Go Home</Button>
      </div>
    );
  }
  const handleBatchGenerate = async () => {
    setIsGenerating(true);
    setResults(null);
    
    try {
      toast.info("Starting batch embedding generation...", {
        description: "This may take several minutes for large datasets."
      });

      const { data, error } = await supabase.functions.invoke('batch-generate-embeddings');

      if (error) throw error;

      setResults(data);
      toast.success("Batch generation complete!", {
        description: `Processed: ${data.processed}, Errors: ${data.errors}, Total: ${data.total}`
      });
    } catch (error: any) {
      console.error('Batch generation error:', error);
      toast.error("Failed to generate embeddings", {
        description: error.message
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleVerify = async () => {
    setIsVerifying(true);
    setVerificationResults(null);
    
    try {
      toast.info("Verifying embeddings in Redis...");

      const { data, error } = await supabase.functions.invoke('verify-embeddings');

      if (error) throw error;

      setVerificationResults(data);
      
      if (data.coveragePercent === 100) {
        toast.success("All properties have embeddings!", {
          description: `${data.embeddingsFound} embeddings verified in Redis`
        });
      } else {
        toast.warning(`${data.coveragePercent}% coverage`, {
          description: `${data.totalMissing} properties missing embeddings`
        });
      }
    } catch (error: any) {
      console.error('Verification error:', error);
      toast.error("Failed to verify embeddings", {
        description: error.message
      });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleTestVectorSearch = async () => {
    setIsTesting(true);
    setTestResults(null);
    
    try {
      toast.info("Running vector search test...");

      const { data, error } = await supabase.functions.invoke('vector-property-search', {
        body: {
          query: testQuery,
          topK: 5,
        }
      });

      if (error) throw error;

      setTestResults(data);
      
      if (data.results?.length > 0) {
        toast.success(`Found ${data.results.length} matching properties!`, {
          description: `Average similarity: ${(data.results.reduce((sum: number, r: any) => sum + r.similarity, 0) / data.results.length).toFixed(3)}`
        });
      } else {
        toast.warning("No results found", {
          description: "Try a different query or check embeddings"
        });
      }
    } catch (error: any) {
      console.error('Vector search test error:', error);
      toast.error("Vector search failed", {
        description: error.message
      });
    } finally {
      setIsTesting(false);
    }
  };
  const handleCrawlListings = async () => {
    setIsCrawling(true);
    setCrawlResults(null);
    setCrawlProgress(null);

    try {
      const selectedMarketplaces = Object.entries(crawlMarketplaces)
        .filter(([, v]) => v)
        .map(([k]) => k);

      if (selectedMarketplaces.length === 0) {
        toast.error("Select at least one marketplace");
        setIsCrawling(false);
        return;
      }

      toast.info("Starting listing crawl...", {
        description: `City: ${crawlCity}, Marketplaces: ${selectedMarketplaces.join(', ')}`
      });

      // Aggregate results across all location calls
      const allResults: any[] = [];
      let totals = { totalFound: 0, totalNew: 0, totalUpdated: 0, totalDuplicatesSkipped: 0, totalVibeAnalyzed: 0, totalSkipped: 0, totalErrors: 0, totalStored: 0 };
      let remainingLocations: string[] | undefined = undefined;
      let locationIndex = 0;
      let totalLocations = 0;

      // First call with no specific locations (let the server use defaults for the city)
      let locationsToSend: string[] = [];

      do {
        const { data, error } = await supabase.functions.invoke('crawl-external-properties', {
          body: {
            city: crawlCity,
            locations: locationsToSend,
            marketplaces: selectedMarketplaces,
            forceRefresh: crawlForceRefresh,
            storeInDatabase: true,
            runVibeAnalysis: crawlRunVibe,
            maxListingsPerLocation: crawlMaxListings,
          }
        });

        if (error) throw error;

        const summary = data?.summary || {};
        remainingLocations = summary.remainingLocations || [];
        
        if (totalLocations === 0) {
          totalLocations = 1 + remainingLocations.length;
        }
        locationIndex++;

        setCrawlProgress({ current: locationIndex, total: totalLocations, location: summary.locationProcessed || '?' });

        // Accumulate
        if (data?.results) allResults.push(...data.results);
        totals.totalFound += summary.totalFound || 0;
        totals.totalNew += summary.totalNew || 0;
        totals.totalUpdated += summary.totalUpdated || 0;
        totals.totalDuplicatesSkipped += summary.totalDuplicatesSkipped || 0;
        totals.totalVibeAnalyzed += summary.totalVibeAnalyzed || 0;
        totals.totalSkipped += summary.totalSkipped || 0;
        totals.totalErrors += summary.totalErrors || 0;
        totals.totalStored += summary.totalStored || 0;

        // Next iteration: send remaining locations so the server picks the first one
        locationsToSend = remainingLocations;
      } while (remainingLocations && remainingLocations.length > 0);

      setCrawlResults({ ...totals, results: allResults });
      setCrawlProgress(null);
      toast.success("Crawl complete!", {
        description: `New: ${totals.totalNew}, Updated: ${totals.totalUpdated}, Duplicates skipped: ${totals.totalDuplicatesSkipped}`
      });
    } catch (error: any) {
      console.error('Crawl error:', error);
      toast.error("Crawl failed", { description: error.message });
    } finally {
      setIsCrawling(false);
      setCrawlProgress(null);
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-4xl space-y-6">
      <h1 className="text-3xl font-bold">Admin Tools</h1>

      {/* Crawl External Listings - moved to top */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Crawl External Listings
          </CardTitle>
          <CardDescription>
            Crawl marketplace listings from batdongsan.com.vn and nhatot.vn, store them in the database with vibe analysis.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>City</Label>
              <select
                value={crawlCity}
                onChange={(e) => setCrawlCity(e.target.value as 'ho_chi_minh' | 'hanoi' | 'da_nang')}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="ho_chi_minh">Ho Chi Minh City</option>
                <option value="hanoi">Hanoi</option>
                <option value="da_nang">Da Nang</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Marketplaces</Label>
              <div className="flex flex-col gap-2 pt-1">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={crawlMarketplaces.batdongsan}
                    onChange={(e) => setCrawlMarketplaces(prev => ({ ...prev, batdongsan: e.target.checked }))}
                    className="rounded"
                  />
                  batdongsan.com.vn
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={crawlMarketplaces.nhatot}
                    onChange={(e) => setCrawlMarketplaces(prev => ({ ...prev, nhatot: e.target.checked }))}
                    className="rounded"
                  />
                  nhatot.vn
                </label>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Switch checked={crawlForceRefresh} onCheckedChange={setCrawlForceRefresh} id="force-refresh" />
              <Label htmlFor="force-refresh" className="text-sm">Force refresh (skip cache)</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={crawlRunVibe} onCheckedChange={setCrawlRunVibe} id="run-vibe" />
              <Label htmlFor="run-vibe" className="text-sm">Run vibe analysis</Label>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Max listings per location</Label>
              <span className="text-sm font-bold text-primary">{crawlMaxListings}</span>
            </div>
            <Slider
              value={[crawlMaxListings]}
              onValueChange={(v) => setCrawlMaxListings(v[0])}
              min={1}
              max={20}
              step={1}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">Controls how many individual listing pages are scraped per location/marketplace combo.</p>
          </div>

          <Button
            onClick={handleCrawlListings}
            disabled={isCrawling}
            size="lg"
            className="w-full"
          >
            {isCrawling ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {crawlProgress 
                  ? `Crawling ${crawlProgress.location} (${crawlProgress.current}/${crawlProgress.total})...`
                  : 'Starting Crawl...'
                }
              </>
            ) : (
              <>
                <Globe className="mr-2 h-4 w-4" />
                Start Crawl
              </>
            )}
          </Button>

          {crawlResults && (
            <div className="p-4 bg-muted rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-semibold">Crawl Results</p>
                <Badge>{crawlResults.duration}</Badge>
              </div>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Found</p>
                  <p className="text-2xl font-bold">{crawlResults.totalFound}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">New</p>
                  <p className="text-2xl font-bold text-primary">{crawlResults.totalNew || 0}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Updated</p>
                  <p className="text-2xl font-bold text-accent-foreground">{crawlResults.totalUpdated || 0}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Duplicates Skipped</p>
                  <p className="text-2xl font-bold text-muted-foreground">{crawlResults.totalDuplicatesSkipped || 0}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Vibe Analyzed</p>
                  <p className="text-2xl font-bold">{crawlResults.totalVibeAnalyzed}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Cache Skipped</p>
                  <p className="text-2xl font-bold text-muted-foreground">{crawlResults.totalSkipped}</p>
                </div>
              </div>

              {crawlResults.results && crawlResults.results.length > 0 && (
                <div className="space-y-1 pt-2 border-t">
                  <p className="text-xs font-semibold text-muted-foreground">Details:</p>
                  {crawlResults.results.map((r: any, idx: number) => (
                    <div key={idx} className="text-xs flex items-center justify-between p-1.5 bg-background rounded">
                      <span>{r.location} / {r.marketplace}</span>
                      <div className="flex gap-2">
                        {r.skipped ? (
                          <Badge variant="secondary" className="text-xs">Skipped</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">
                            {r.propertiesFound} found, {r.propertiesStored} stored
                          </Badge>
                        )}
                        {r.error && <Badge variant="destructive" className="text-xs">Error</Badge>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="text-sm text-muted-foreground space-y-1 pt-2 border-t">
            <p><strong>Note:</strong> Crawling uses Firecrawl + GPT-4o-mini for scraping and extraction. Each location/marketplace combo takes ~30-60s.</p>
            <p><strong>Cache:</strong> Results are cached for 6 hours unless force refresh is enabled.</p>
          </div>
        </CardContent>
      </Card>

      {/* Batch Re-analyze Image Highlights */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Backfill Image Highlights
          </CardTitle>
          <CardDescription>
            Re-analyze external properties that have legacy <code>per_image</code> data but missing <code>image_analyses</code> in vibe_analysis.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={handleBatchReanalyzeImageHighlights}
            disabled={isBatchReanalyzing}
            size="lg"
            className="w-full"
          >
            {isBatchReanalyzing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Re-analyzing...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Backfill Image Highlights
              </>
            )}
          </Button>

          {batchReanalyzeResults && (
            <div className="p-4 bg-muted rounded-lg space-y-2">
              <p className="font-semibold">Backfill Results</p>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Found</p>
                  <p className="text-2xl font-bold">{batchReanalyzeResults.total}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Fixed</p>
                  <p className="text-2xl font-bold text-primary">{batchReanalyzeResults.fixed}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Errors</p>
                  <p className="text-2xl font-bold text-destructive">{batchReanalyzeResults.errors}</p>
                </div>
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Finds properties with old <code>per_image</code> format or missing <code>image_analyses</code>, then calls analyze-vibe to generate proper per-image highlights.
          </p>
        </CardContent>
      </Card>

      <Card className={isPaused ? 'border-destructive/30 opacity-80' : ''}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Auto-Crawl Schedule
                {isPaused && <Badge variant="destructive" className="text-xs">Paused</Badge>}
                {!isPaused && <Badge variant="default" className="text-xs bg-emerald-600">Active</Badge>}
              </CardTitle>
              <CardDescription className="mt-1">
                Cron runs every 30 min. The function checks config and crawls the least-recently-crawled location.
              </CardDescription>
            </div>
            <Button
              variant={isPaused ? 'default' : 'destructive'}
              size="sm"
              onClick={handleTogglePause}
              disabled={isSavingConfig}
              className="shrink-0"
            >
              {isSavingConfig ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isPaused ? (
                <><Play className="h-4 w-4 mr-1" /> Resume</>
              ) : (
                <><Pause className="h-4 w-4 mr-1" /> Pause</>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Crawl Settings */}
          <div className="border rounded-lg p-3 space-y-3">
            <p className="text-sm font-semibold flex items-center gap-1">
              <Settings2 className="h-4 w-4" /> Crawl Settings
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Re-crawl cooldown</Label>
                  <span className="text-xs font-bold text-primary">
                    {effectiveFrequency >= 60 
                      ? `${Math.round(effectiveFrequency / 60 * 10) / 10}h` 
                      : `${effectiveFrequency}min`}
                  </span>
                </div>
                <Slider
                  value={[effectiveFrequency]}
                  onValueChange={(v) => setLocalFrequency(v[0])}
                  min={30}
                  max={720}
                  step={30}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground">
                  How long before the same location can be re-crawled
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Max listings per run</Label>
                  <span className="text-xs font-bold text-primary">{effectiveMaxListings}</span>
                </div>
                <Slider
                  value={[effectiveMaxListings]}
                  onValueChange={(v) => setLocalMaxListings(v[0])}
                  min={1}
                  max={20}
                  step={1}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground">
                  Maximum listings scraped per location per run
                </p>
              </div>
            </div>
            {hasUnsavedChanges && (
              <div className="flex justify-end pt-1">
                <Button
                  size="sm"
                  onClick={handleSaveConfig}
                  disabled={isSavingConfig}
                  className="h-7 text-xs"
                >
                  {isSavingConfig ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                  Save Settings
                </Button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 bg-muted rounded-lg text-center">
              <p className="text-xs text-muted-foreground">Cron Interval</p>
              <p className="text-sm font-bold">Every 30 min</p>
            </div>
            <div className="p-3 bg-muted rounded-lg text-center">
              <p className="text-xs text-muted-foreground">Locations</p>
              <p className="text-sm font-bold">60 districts</p>
            </div>
            <div className="p-3 bg-muted rounded-lg text-center">
              <p className="text-xs text-muted-foreground">Marketplaces</p>
              <p className="text-sm font-bold">batdongsan + nhatot</p>
            </div>
            <div className="p-3 bg-muted rounded-lg text-center">
              <p className="text-xs text-muted-foreground">Cooldown</p>
              <p className="text-sm font-bold">
                {effectiveFrequency >= 60 
                  ? `${Math.round(effectiveFrequency / 60 * 10) / 10}h` 
                  : `${effectiveFrequency}min`}
              </p>
            </div>
          </div>

          {/* Dynamic Coverage Tracker */}
          <div className="text-sm space-y-3 border-t pt-3">
            <p className="font-semibold flex items-center gap-1"><Calendar className="h-4 w-4" /> District Coverage Tracker</p>
            {(() => {
              const ALL_DISTRICTS: Record<string, { label: string; districts: string[] }> = {
                ho_chi_minh: {
                  label: 'Ho Chi Minh City',
                  districts: ['quận 1','quận 3','quận 4','quận 5','quận 6','quận 7','quận 8','quận 10','quận 11','quận 12','bình thạnh','phú nhuận','tân bình','tân phú','gò vấp','bình tân','thủ đức','nhà bè','bình chánh','hóc môn','củ chi','cần giờ'],
                },
                hanoi: {
                  label: 'Hanoi',
                  districts: ['ba đình','hoàn kiếm','đống đa','cầu giấy','hai bà trưng','tây hồ','long biên','thanh xuân','hoàng mai','bắc từ liêm','nam từ liêm','hà đông','gia lâm','đông anh','sóc sơn','thanh trì','hoài đức','thanh oai','thường tín','mê linh','chương mỹ','đan phượng','phúc thọ','quốc oai','thạch thất','ba vì','sơn tây','phú xuyên','ứng hòa','mỹ đức'],
                },
                da_nang: {
                  label: 'Da Nang',
                  districts: ['hải châu','thanh khê','sơn trà','ngũ hành sơn','liên chiểu','cẩm lệ','hòa vang','hoàng sa'],
                },
              };

              const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

              const totalDistricts = Object.values(ALL_DISTRICTS).reduce((sum, c) => sum + c.districts.length, 0);
              let totalCrawled = 0;

              return (
                <div className="space-y-4">
                  {Object.entries(ALL_DISTRICTS).map(([cityKey, cityData]) => {
                    const crawledCount = cityData.districts.filter(d => {
                      const norm = normalize(d);
                      if (!districtCoverage) return false;
                      for (const [key] of districtCoverage) {
                        if (key === norm || key.includes(norm) || norm.includes(key)) return true;
                      }
                      return false;
                    }).length;
                    totalCrawled += crawledCount;
                    const pct = Math.round((crawledCount / cityData.districts.length) * 100);

                    return (
                      <div key={cityKey} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="font-medium text-xs">{cityData.label} ({crawledCount}/{cityData.districts.length})</p>
                          <Badge variant={pct === 100 ? 'default' : pct > 0 ? 'secondary' : 'outline'} className="text-xs">
                            {pct}%
                          </Badge>
                        </div>
                        <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {cityData.districts.map(district => {
                            const norm = normalize(district);
                            let info: { lastCrawled: string; sources: Set<string>; count: number } | null = null;
                            if (districtCoverage) {
                              for (const [key, val] of districtCoverage) {
                                if (key === norm || key.includes(norm) || norm.includes(key)) {
                                  info = val;
                                  break;
                                }
                              }
                            }
                            const isCrawled = !!info;
                            const displayName = district.replace(/^quận /, 'Q');
                            return (
                              <span
                                key={district}
                                title={isCrawled
                                  ? `Last crawled: ${getTimeAgo(info!.lastCrawled)} · ${info!.count} listings · Sources: ${Array.from(info!.sources).join(', ')}`
                                  : 'Not yet crawled'}
                                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                                  isCrawled
                                    ? 'bg-primary/10 text-primary border-primary/20'
                                    : 'bg-muted text-muted-foreground border-border'
                                }`}
                              >
                                {isCrawled ? <CheckCircle2 className="h-2.5 w-2.5" /> : <Clock className="h-2.5 w-2.5 opacity-40" />}
                                {displayName}
                                {isCrawled && <span className="opacity-60">({getTimeAgo(info!.lastCrawled)})</span>}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  <div className="flex items-center justify-between pt-1 border-t text-xs text-muted-foreground">
                    <span>Total: {totalCrawled}/{totalDistricts} districts crawled</span>
                    <span>{Math.round((totalCrawled / totalDistricts) * 100)}% coverage</span>
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="text-sm text-muted-foreground space-y-1 border-t pt-3">
            <p><strong>Deduplication:</strong> URL normalization + database check prevents duplicate entries.</p>
            <p><strong>Fake filter:</strong> Listings with price &lt;2M or &gt;200M VND, no images, sale keywords, or invalid phone numbers are automatically rejected.</p>
            <p><strong>Freshness:</strong> Skips locations crawled within the last 4 hours. Listings expire after 10 days.</p>
          </div>

          {/* Active Listings Stats */}
          {crawlStats && (
            <div className="border-t pt-3 space-y-2">
              <p className="text-sm font-semibold flex items-center gap-1">
                <Activity className="h-4 w-4" /> Active Listings: {crawlStats.total}
              </p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(crawlStats.byCitySource).map(([key, count]) => {
                  const [city, source] = key.split('/');
                  const cityLabel = city === 'ho_chi_minh' ? 'HCM' : city === 'hanoi' ? 'Hanoi' : city === 'da_nang' ? 'Da Nang' : city;
                  return (
                    <Badge key={key} variant="outline" className="text-xs">
                      {cityLabel} / {source}: {count}
                    </Badge>
                  );
                })}
              </div>
            </div>
          )}

          {/* Crawl Activity Log */}
          <div className="border-t pt-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold flex items-center gap-1">
                <Clock className="h-4 w-4" /> Recent Crawl Runs
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => refetchCrawlActivity()}
                  className="h-7 text-xs"
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Refresh
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={isManualCrawlTriggering}
                  onClick={async () => {
                    setIsManualCrawlTriggering(true);
                    try {
                      const { data, error } = await supabase.functions.invoke('scheduled-crawl', { body: {} });
                      if (error) throw error;
                      toast.success('Auto-crawl triggered', {
                        description: data?.summary 
                          ? `${data.summary.target?.location}/${data.summary.target?.marketplace}: ${data.summary.newListings || 0} new, ${data.summary.filteredOut || 0} filtered`
                          : data?.message || 'Completed'
                      });
                      refetchCrawlActivity();
                    } catch (err: any) {
                      toast.error('Failed to trigger crawl', { description: err.message });
                    } finally {
                      setIsManualCrawlTriggering(false);
                    }
                  }}
                  className="h-7 text-xs"
                >
                  {isManualCrawlTriggering ? (
                    <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Running...</>
                  ) : (
                    <>Trigger Now</>
                  )}
                </Button>
              </div>
            </div>

            {crawlActivity && crawlActivity.length > 0 ? (
              <div className="space-y-1.5 max-h-80 overflow-y-auto">
                {crawlActivity.map((run, idx) => {
                  const timeAgo = getTimeAgo(run.timestamp);
                  const cityLabel = run.city === 'ho_chi_minh' ? 'HCM' : run.city === 'hanoi' ? 'Hanoi' : run.city === 'da_nang' ? 'Da Nang' : run.city;
                  const isExpanded = expandedRunIdx === idx;
                  return (
                    <div key={idx} className="space-y-1.5">
                      <div className="flex items-center justify-between p-2 bg-muted/50 rounded text-xs gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-muted-foreground whitespace-nowrap">{timeAgo}</span>
                          <Badge variant="outline" className="text-xs shrink-0">{cityLabel}</Badge>
                          <Badge variant="secondary" className="text-xs shrink-0">{run.source}</Badge>
                          <span className="truncate text-muted-foreground">{run.location}</span>
                        </div>
                        <Badge
                          className="text-xs shrink-0 cursor-pointer hover:bg-primary/80 transition-colors"
                          onClick={() => handleExpandRun(idx, run.propertyIds)}
                        >
                          {run.count} listings {isExpanded ? '▲' : '▼'}
                        </Badge>
                      </div>
                      {isExpanded && (
                        <div className="ml-4 border-l-2 border-primary/20 pl-3 space-y-1.5">
                          {isLoadingRunProperties ? (
                            <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                              <Loader2 className="h-3 w-3 animate-spin" /> Loading properties...
                            </div>
                          ) : expandedRunProperties.length > 0 ? (
                            expandedRunProperties.map((prop) => {
                              const vibeAnalysis = prop.vibe_analysis as any;
                              const hasPerImage = vibeAnalysis?.per_image && vibeAnalysis.per_image.length > 0;
                              const imageCount = (prop.images || []).length;
                              return (
                                <div
                                  key={prop.id}
                                  className="flex items-center gap-2 p-1.5 bg-background rounded border cursor-pointer hover:border-primary/50 transition-colors text-xs"
                                  onClick={() => setPreviewProperty(prop)}
                                >
                                  {imageCount > 0 ? (
                                    <img
                                      src={prop.images[0]}
                                      alt=""
                                      className="h-10 w-14 rounded object-cover shrink-0"
                                      loading="lazy"
                                    />
                                  ) : (
                                    <div className="h-10 w-14 rounded bg-muted flex items-center justify-center shrink-0">
                                      <ImageIcon className="h-4 w-4 text-muted-foreground/40" />
                                    </div>
                                  )}
                                  <div className="min-w-0 flex-1">
                                    <p className="font-medium truncate">{prop.title}</p>
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-primary font-bold">
                                        {prop.price ? `${(prop.price / 1_000_000).toFixed(1)}M` : 'N/A'}
                                      </span>
                                      <Badge variant={hasPerImage ? 'default' : 'destructive'} className="text-[8px] px-1 py-0 h-3.5">
                                        {hasPerImage ? '✓ vibe' : '✗ vibe'}
                                      </Badge>
                                      <span className="text-muted-foreground truncate">{prop.location}</span>
                                    </div>
                                  </div>
                                  <Eye className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                </div>
                              );
                            })
                          ) : (
                            <p className="text-xs text-muted-foreground italic py-1">No properties found.</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">No crawl runs recorded yet. Cron job runs every 30 minutes.</p>
            )}
          </div>
        </CardContent>
      </Card>



      {/* Property Preview Dialog */}
      <Dialog open={!!previewProperty} onOpenChange={(open) => !open && setPreviewProperty(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {previewProperty && (() => {
            const vibeAnalysis = previewProperty.vibe_analysis as any;
            const perImage = vibeAnalysis?.per_image || [];
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="text-lg">{previewProperty.title}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  {/* Images with highlights */}
                  <div className="space-y-3">
                    {(previewProperty.images || []).map((img: string, i: number) => {
                      const imgAnalysis = perImage[i];
                      return (
                        <div key={i} className="space-y-1">
                          <img
                            src={img}
                            alt={`Image ${i + 1}`}
                            className="w-full rounded-lg object-cover max-h-64"
                          />
                          {imgAnalysis?.image_highlight && (
                            <p className="text-xs text-primary font-medium px-1">
                              ✨ {imgAnalysis.image_highlight}
                            </p>
                          )}
                          {imgAnalysis?.vibe_scores && (
                            <div className="flex flex-wrap gap-1 px-1">
                              {Object.entries(imgAnalysis.vibe_scores)
                                .filter(([, v]) => (v as number) >= 6)
                                .sort(([, a], [, b]) => (b as number) - (a as number))
                                .slice(0, 4)
                                .map(([key, val]) => (
                                  <Badge key={key} variant="outline" className="text-[9px] px-1 py-0">
                                    {key}: {val as number}/10
                                  </Badge>
                                ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Property info */}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-muted-foreground text-xs">Location</p>
                      <p className="font-medium">{previewProperty.location}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Price</p>
                      <p className="font-medium">{previewProperty.price ? `${(previewProperty.price / 1_000_000).toFixed(1)}M VND` : 'N/A'}</p>
                    </div>
                    {previewProperty.size && (
                      <div>
                        <p className="text-muted-foreground text-xs">Size</p>
                        <p className="font-medium">{previewProperty.size}</p>
                      </div>
                    )}
                    {previewProperty.rooms && (
                      <div>
                        <p className="text-muted-foreground text-xs">Rooms</p>
                        <p className="font-medium">{previewProperty.rooms}</p>
                      </div>
                    )}
                    {previewProperty.contact_name && (
                      <div>
                        <p className="text-muted-foreground text-xs">Contact</p>
                        <p className="font-medium">{previewProperty.contact_name} {previewProperty.contact_phone && `· ${previewProperty.contact_phone}`}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-muted-foreground text-xs">Source</p>
                      <p className="font-medium">{previewProperty.source}</p>
                    </div>
                  </div>

                  {/* Highlights */}
                  {previewProperty.highlights && previewProperty.highlights.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-1">Highlights</p>
                      <div className="flex flex-wrap gap-1">
                        {previewProperty.highlights.map((h: string, i: number) => (
                          <Badge key={i} variant="secondary" className="text-xs">{h}</Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Amenities */}
                  {previewProperty.amenities && previewProperty.amenities.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-1">Amenities</p>
                      <div className="flex flex-wrap gap-1">
                        {previewProperty.amenities.map((a: string, i: number) => (
                          <Badge key={i} variant="outline" className="text-xs">{a}</Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Vibe Analysis Summary */}
                  {vibeAnalysis && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-1">Vibe Analysis</p>
                      <div className="p-2 bg-muted rounded text-xs space-y-1">
                        {vibeAnalysis.styles && <p><span className="font-medium">Styles:</span> {vibeAnalysis.styles.join(', ')}</p>}
                        {vibeAnalysis.colors && <p><span className="font-medium">Colors:</span> {vibeAnalysis.colors.join(', ')}</p>}
                        {vibeAnalysis.activities && <p><span className="font-medium">Activities:</span> {vibeAnalysis.activities.join(', ')}</p>}
                        <p><span className="font-medium">Per-image analyses:</span> {perImage.length}</p>
                      </div>
                    </div>
                  )}

                  {/* Source link */}
                  {previewProperty.source_url && (
                    <a
                      href={previewProperty.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      View original listing
                    </a>
                  )}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>


      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Vector DB - Batch Generate Embeddings
          </CardTitle>
          <CardDescription>
            Generate embeddings for all existing properties in the database. This enables semantic search for properties uploaded before vector DB integration.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button 
            onClick={handleBatchGenerate} 
            disabled={isGenerating}
            size="lg"
            className="w-full"
          >
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating Embeddings...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Generate All Property Embeddings
              </>
            )}
          </Button>

          {results && (
            <div className="p-4 bg-muted rounded-lg space-y-2">
              <p className="font-semibold">Results:</p>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Total Properties</p>
                  <p className="text-2xl font-bold">{results.total}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Processed</p>
                  <p className="text-2xl font-bold text-green-600">{results.processed}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Errors</p>
                  <p className="text-2xl font-bold text-destructive">{results.errors}</p>
                </div>
              </div>
            </div>
          )}

          <div className="text-sm text-muted-foreground space-y-1">
            <p><strong>Note:</strong> This operation processes properties in batches of 10 with 1-second delays to respect rate limits.</p>
            <p><strong>Cost:</strong> Approximately $0.02 per 1000 properties (OpenAI embeddings).</p>
            <p><strong>Duration:</strong> ~10 seconds per 100 properties.</p>
          </div>
        </CardContent>
      </Card>

      {/* Verify Embeddings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5" />
            Verify Embeddings in Redis
          </CardTitle>
          <CardDescription>
            Check Redis to verify that all properties have embeddings stored and view coverage statistics.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button 
            onClick={handleVerify} 
            disabled={isVerifying}
            size="lg"
            variant="outline"
            className="w-full"
          >
            {isVerifying ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Verifying...
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Verify Redis Embeddings
              </>
            )}
          </Button>

          {verificationResults && (
            <div className="space-y-4">
              <div className="p-4 bg-muted rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-semibold">Coverage Status:</p>
                  <Badge 
                    variant={verificationResults.coveragePercent === 100 ? "default" : "destructive"}
                    className="text-lg px-3 py-1"
                  >
                    {verificationResults.coveragePercent}%
                  </Badge>
                </div>
                
                <div className="grid grid-cols-3 gap-4 text-sm pt-2 border-t">
                  <div>
                    <p className="text-muted-foreground">Total Properties</p>
                    <p className="text-2xl font-bold">{verificationResults.totalProperties}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Embeddings Found</p>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <p className="text-2xl font-bold text-green-600">{verificationResults.embeddingsFound}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Missing</p>
                    <div className="flex items-center gap-2">
                      {verificationResults.totalMissing > 0 && <XCircle className="h-4 w-4 text-destructive" />}
                      <p className="text-2xl font-bold text-destructive">{verificationResults.totalMissing}</p>
                    </div>
                  </div>
                </div>
              </div>

              {verificationResults.sampleEmbeddings.length > 0 && (
                <div className="p-4 bg-muted rounded-lg space-y-2">
                  <p className="font-semibold text-sm">Sample Embeddings:</p>
                  {verificationResults.sampleEmbeddings.map((sample, idx) => (
                    <div key={idx} className="text-xs space-y-1 p-2 bg-background rounded">
                      <p className="font-mono text-muted-foreground">{sample.propertyId}</p>
                      <p className="font-semibold truncate">{sample.title}</p>
                      <div className="flex gap-2 text-muted-foreground">
                        <span>Dimensions: {sample.dimensions}</span>
                        <span>•</span>
                        <span>Metadata: {sample.hasMetadata ? '✓' : '✗'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {verificationResults.totalMissing > 0 && (
                <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm">
                  <p className="font-semibold text-destructive mb-1">Missing Embeddings Detected</p>
                  <p className="text-muted-foreground">
                    Run the batch generation again to generate embeddings for {verificationResults.totalMissing} properties.
                  </p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Test Vector Search */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Test Vector Search
          </CardTitle>
          <CardDescription>
            Test semantic property search with natural language queries to verify vector DB is working correctly.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="testQuery">Natural Language Query</Label>
            <Textarea
              id="testQuery"
              value={testQuery}
              onChange={(e) => setTestQuery(e.target.value)}
              placeholder="Describe what you're looking for..."
              rows={3}
            />
          </div>
          
          <Button 
            onClick={handleTestVectorSearch} 
            disabled={isTesting || !testQuery.trim()}
            size="lg"
            className="w-full"
          >
            {isTesting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Searching...
              </>
            ) : (
              <>
                <Search className="mr-2 h-4 w-4" />
                Test Vector Search
              </>
            )}
          </Button>

          {testResults && (
            <div className="space-y-4">
              <div className="p-4 bg-muted rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-semibold">Search Results:</p>
                  <Badge>{testResults.results?.length || 0} matches</Badge>
                </div>
                
                {testResults.cached && (
                  <p className="text-xs text-muted-foreground mb-2">⚡ Cached result</p>
                )}
              </div>

              {testResults.results && testResults.results.length > 0 && (
                <div className="space-y-2">
                  {testResults.results.slice(0, 5).map((result: any, idx: number) => (
                    <div key={idx} className="p-3 bg-background rounded border space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold truncate">{result.title}</p>
                          <p className="text-xs text-muted-foreground truncate">{result.location}</p>
                        </div>
                        <Badge variant="outline" className="shrink-0">
                          {(result.similarity * 100).toFixed(1)}%
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        ${result.price?.toLocaleString()}
                        {result.styles && ` • ${result.styles.slice(0, 2).join(', ')}`}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {testResults.processingTime && (
                <p className="text-xs text-muted-foreground text-center">
                  Processed in {testResults.processingTime}ms
                </p>
              )}
            </div>
          )}

          <div className="text-sm text-muted-foreground space-y-1 pt-2 border-t">
            <p><strong>Try queries like:</strong></p>
            <ul className="list-disc list-inside space-y-0.5 text-xs">
              <li>"Bright apartment with modern kitchen"</li>
              <li>"Cozy space perfect for remote work"</li>
              <li>"Luxury penthouse with city views"</li>
              <li>"Industrial loft with high ceilings"</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminTools;
