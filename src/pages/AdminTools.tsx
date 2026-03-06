import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Slider } from "@/components/ui/slider";
import { Loader2, Sparkles, CheckCircle2, XCircle, Search, Globe, ShieldAlert, Clock, Calendar, Activity, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

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

  // Fetch recent crawl activity from external_properties
  const { data: crawlActivity, refetch: refetchCrawlActivity } = useQuery({
    queryKey: ['crawl-activity'],
    queryFn: async () => {
      // Get the 50 most recently crawled properties grouped by approximate crawl time
      const { data, error } = await supabase
        .from('external_properties')
        .select('id, city, source, location_normalized, crawled_at, title, price, is_active')
        .order('crawled_at', { ascending: false })
        .limit(200);
      
      if (error) throw error;
      if (!data || data.length === 0) return [];

      // Group by crawl runs (properties crawled within 5 minutes of each other)
      const runs: Array<{
        timestamp: string;
        city: string;
        source: string;
        location: string;
        count: number;
        listings: Array<{ title: string; price: number }>;
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
            listings: [],
          };
          runs.push(currentRun);
        }
        
        currentRun.count++;
        if (currentRun.listings.length < 3) {
          currentRun.listings.push({ title: prop.title || 'Unknown', price: prop.price || 0 });
        }
      }

      return runs.slice(0, 10);
    },
    refetchInterval: 60000, // Refresh every minute
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

      {/* Auto-Crawl Schedule Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Auto-Crawl Schedule
          </CardTitle>
          <CardDescription>
            Automated crawling runs every 30 minutes, rotating through 17 locations × 2 marketplaces. Each run picks the least-recently-crawled location. Fake listings are filtered by price range, missing images, and sale keywords.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 bg-muted rounded-lg text-center">
              <p className="text-xs text-muted-foreground">Schedule</p>
              <p className="text-sm font-bold">Every 30 min</p>
            </div>
            <div className="p-3 bg-muted rounded-lg text-center">
              <p className="text-xs text-muted-foreground">Locations</p>
              <p className="text-sm font-bold">17 districts</p>
            </div>
            <div className="p-3 bg-muted rounded-lg text-center">
              <p className="text-xs text-muted-foreground">Marketplaces</p>
              <p className="text-sm font-bold">batdongsan + nhatot</p>
            </div>
            <div className="p-3 bg-muted rounded-lg text-center">
              <p className="text-xs text-muted-foreground">Est. Daily New</p>
              <p className="text-sm font-bold">~50-100 listings</p>
            </div>
          </div>

          <div className="text-sm space-y-2 border-t pt-3">
            <p className="font-semibold flex items-center gap-1"><Calendar className="h-4 w-4" /> Coverage</p>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <p className="font-medium text-muted-foreground mb-1">HCM (8 districts)</p>
                <p>D1, D2, D3, D7, Bình Thạnh, Phú Nhuận, Tân Bình, Thủ Đức</p>
              </div>
              <div>
                <p className="font-medium text-muted-foreground mb-1">Hanoi (5 districts)</p>
                <p>Ba Đình, Hoàn Kiếm, Đống Đa, Cầu Giấy, Hai Bà Trưng</p>
              </div>
              <div>
                <p className="font-medium text-muted-foreground mb-1">Da Nang (3 districts)</p>
                <p>Hải Châu, Sơn Trà, Ngũ Hành Sơn</p>
              </div>
            </div>
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
                  return (
                    <div key={idx} className="flex items-center justify-between p-2 bg-muted/50 rounded text-xs gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-muted-foreground whitespace-nowrap">{timeAgo}</span>
                        <Badge variant="outline" className="text-xs shrink-0">{cityLabel}</Badge>
                        <Badge variant="secondary" className="text-xs shrink-0">{run.source}</Badge>
                        <span className="truncate text-muted-foreground">{run.location}</span>
                      </div>
                      <Badge className="text-xs shrink-0">{run.count} listings</Badge>
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

      {/* Vector DB - Batch Generate Embeddings */}
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
