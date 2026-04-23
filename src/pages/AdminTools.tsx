import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Slider } from "@/components/ui/slider";
import { Loader2, Sparkles, CheckCircle2, XCircle, Search, Globe, ShieldAlert, Clock, Calendar, Activity, RefreshCw, Pause, Play, Settings2, Eye, MapPin, Image as ImageIcon, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
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

// Convert verifier raw reason codes into human-readable explanations
function explainVerificationReason(reason: string | null | undefined): string {
  if (!reason) return 'Unknown';
  if (reason.startsWith('http_404') || reason.startsWith('http_410')) return 'Page removed (404/410)';
  if (reason.startsWith('http_5')) return 'Source site error';
  if (reason.startsWith('http_')) return `HTTP ${reason.replace('http_', '')}`;
  if (reason === 'redirect_expired') return 'Redirected to "expired" page';
  if (reason === 'tiny_response') return 'Empty / notice page returned';
  if (reason === 'no_browserless_key') return 'Browserless key missing';
  if (reason.startsWith('browserless_')) return `Browserless error (${reason.replace('browserless_', '')})`;
  if (reason.startsWith('keyword:')) {
    const kw = reason.slice('keyword:'.length);
    return `Listing marked removed: "${kw}"`;
  }
  if (reason === 'unknown_source') return 'Unknown source type';
  if (reason.toLowerCase().includes('abort') || reason.toLowerCase().includes('timeout')) return 'Request timed out';
  return reason;
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
  const [backfillProgress, setBackfillProgress] = useState<{ current: number; total: number; currentTitle: string; fixed: number; errors: number } | null>(null);

  // Verify external listings state
  const [isVerifyingListings, setIsVerifyingListings] = useState(false);
  const [verifyListingsResult, setVerifyListingsResult] = useState<{ checked: number; alive: number; deactivated: number; dead_increment: number; errors: number } | null>(null);
  const [reExtractingId, setReExtractingId] = useState<string | null>(null);

  // State for expanded crawl run
  const [expandedRunIdx, setExpandedRunIdx] = useState<number | null>(null);
  const [expandedRunProperties, setExpandedRunProperties] = useState<any[]>([]);
  const [expandedRunPropertyIds, setExpandedRunPropertyIds] = useState<string[]>([]);
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

      const extractDistrict = (loc: string | null): string => {
        if (!loc) return 'unknown';
        // location_normalized often strips diacritics + spaces (e.g. "qun 4", "huyn binh chanh")
        // Tokens come either as comma-separated parts or as a single run-on string.
        // Strategy: scan for a "district keyword + value" pair anywhere in the text.
        const text = loc.toLowerCase();

        // 1. Numbered HCM districts: "qun 4", "quan 4", "q.4", "d4", "district 4"
        const numbered = text.match(/\b(?:qu[aâậ]?n|quan|q\.?|district|d)\s*(\d{1,2})\b/);
        if (numbered) return `Quận ${numbered[1]}`;

        // 2. Named districts/huyện: capture keyword + 1–3 following words (until next admin keyword or end)
        const named = text.match(
          /\b(qu[aâậ]?n|quan|huy[eệ]?n|huyen)\s+([a-zà-ỹ]+(?:\s+[a-zà-ỹ]+){0,2}?)(?=\s+(?:phng|phuong|phuờng|tp|thanh pho|th[aàả]nh ph[oốồ]|$|,))/
        );
        if (named) {
          const kw = /huy/.test(named[1]) ? 'Huyện' : 'Quận';
          const name = named[2].replace(/\b\w/g, (c) => c.toUpperCase());
          return `${kw} ${name}`;
        }

        // 3. Thủ Đức city
        if (/\bth[uủ]\s*[dđ][uưứ]?c\b/.test(text)) return 'Thủ Đức';

        // 4. Fallback: second-to-last comma segment
        const parts = loc.split(',').map((p) => p.trim()).filter(Boolean);
        if (parts.length >= 2) return parts[parts.length - 2];
        return parts[0] || 'unknown';
      };

      let currentRun: (typeof runs[0] & { districts: Set<string> }) | null = null;

      for (const prop of data) {
        const crawlTime = new Date(prop.crawled_at!).getTime();
        const district = extractDistrict(prop.location_normalized);
        
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
            location: '',
            count: 0,
            propertyIds: [],
            districts: new Set<string>(),
          };
          runs.push(currentRun);
        }
        
        currentRun.count++;
        currentRun.propertyIds.push(prop.id);
        if (district && district !== 'unknown') currentRun.districts.add(district);
        currentRun.location = Array.from(currentRun.districts).slice(0, 3).join(', ');
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

  const fetchExpandedRunProperties = async (propertyIds: string[], showLoading = false) => {
    if (showLoading) setIsLoadingRunProperties(true);
    try {
      const { data, error } = await supabase
        .from('external_properties')
        .select('id, title, location, price, images, vibe, vibe_analysis, vibe_status, highlights, amenities, source, source_url, city, crawled_at, is_active, size, rooms, contact_name, contact_phone')
        .in('id', propertyIds);
      if (error) throw error;
      setExpandedRunProperties(data || []);
    } catch {
      if (showLoading) setExpandedRunProperties([]);
    } finally {
      if (showLoading) setIsLoadingRunProperties(false);
    }
  };

  const handleExpandRun = async (idx: number, propertyIds: string[]) => {
    if (expandedRunIdx === idx) {
      setExpandedRunIdx(null);
      setExpandedRunProperties([]);
      setExpandedRunPropertyIds([]);
      return;
    }
    setExpandedRunIdx(idx);
    setExpandedRunPropertyIds(propertyIds);
    await fetchExpandedRunProperties(propertyIds, true);
  };

  // Auto-refresh expanded run properties every 30s so badges (e.g. ✓/✗ vibe) reflect backfill progress live
  useEffect(() => {
    if (expandedRunIdx === null || expandedRunPropertyIds.length === 0) return;
    const interval = setInterval(() => {
      fetchExpandedRunProperties(expandedRunPropertyIds, false);
    }, 30000);
    return () => clearInterval(interval);
  }, [expandedRunIdx, expandedRunPropertyIds]);


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

  // Verify external listings (must be before any early return to keep hook order stable)
  const { data: verifyStats, refetch: refetchVerifyStats } = useQuery({
    queryKey: ['external-verify-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('external_properties')
        .select('id, title, source, source_url, last_verified_at, last_verification_status, last_verification_reason, verification_failures, contact_phone, phone_extraction_attempts')
        .eq('is_active', true)
        .order('last_verified_at', { ascending: true, nullsFirst: true })
        .limit(20);
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 60_000,
    enabled: !!user && !!isAdmin,
  });

  // Recently auto-deactivated listings (so admin sees what was removed and why)
  const { data: deactivatedListings, refetch: refetchDeactivated } = useQuery({
    queryKey: ['external-deactivated'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('external_properties')
        .select('id, title, source, source_url, deactivated_at, last_verification_reason, verification_failures, last_verified_at')
        .eq('is_active', false)
        .not('deactivated_at', 'is', null)
        .order('deactivated_at', { ascending: false })
        .limit(15);
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 60_000,
    enabled: !!user && !!isAdmin,
  });

  // Show loading while checking auth/role
  if (authLoading || isCheckingRole) {
    return (
      <div className="container mx-auto px-3 py-4 md:p-6 max-w-4xl flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Block access if not authenticated or not admin
  if (!user || !isAdmin) {
    return (
      <div className="container mx-auto px-3 py-4 md:p-6 max-w-4xl flex flex-col items-center justify-center min-h-[60vh] text-center gap-4">
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

  const handleBatchReanalyzeImageHighlights = async () => {
    setIsBatchReanalyzing(true);
    setBatchReanalyzeResults(null);
    setBackfillProgress(null);

    try {
      toast.info("Finding properties with missing valid image highlights...");

      // Fetch external properties that need re-analysis (have images but missing usable per-image highlights)
      const { data: properties, error: fetchError } = await supabase
        .from('external_properties')
        .select('id, title, images, vibe_analysis')
        .eq('is_active', true)
        .not('images', 'eq', '{}')
        .limit(500);

      if (fetchError) throw fetchError;

      const isUsableHighlight = (value: unknown) => {
        const text = String(value || '').trim();
        return !!text && text !== 'Premium living space feature' && text !== 'Quality living space';
      };

      // Re-analyze if legacy data exists, image_analyses are missing, or only empty/generic secondary highlights exist
      const needsReanalysis = (properties || []).filter((p: any) => {
        const va = p.vibe_analysis;
        const analyses = Array.isArray(va?.image_analyses) ? va.image_analyses : [];

        if (!va || typeof va !== 'object') return true;
        if (va.per_image && analyses.length === 0) return true;
        if (analyses.length === 0) return true;

        const hasUsableSecondaryHighlight = analyses.some((analysis: any) => {
          const imageIndex = Number(analysis?.image_index);
          const highlight = analysis?.image_highlight || analysis?.highlight;
          return Number.isFinite(imageIndex) && imageIndex > 0 && isUsableHighlight(highlight);
        });

        return !hasUsableSecondaryHighlight;
      });

      const total = needsReanalysis.length;
      if (total === 0) {
        toast.success("All properties already have valid image highlights!");
        setBatchReanalyzeResults({ total: 0, fixed: 0, errors: 0 });
        setIsBatchReanalyzing(false);
        return;
      }

      toast.info(`Found ${total} properties to re-analyze. Processing...`);

      let fixed = 0;
      let errors = 0;

      // Process one at a time to avoid rate limits
      for (let i = 0; i < needsReanalysis.length; i++) {
        const prop = needsReanalysis[i];
        setBackfillProgress({ current: i + 1, total, currentTitle: prop.title || 'Unknown', fixed, errors });
        try {
          const imagesToAnalyze = (prop.images || []).slice(0, 5);
          if (imagesToAnalyze.length === 0) continue;

          const { data: analyzeData, error: analyzeError } = await supabase.functions.invoke('analyze-vibe', {
            body: {
              imageUrls: imagesToAnalyze,
              generateContent: true,
              propertyInfo: { title: prop.title },
            },
          });

          if (analyzeError) throw analyzeError;

          const analyses = analyzeData?.analysis?.image_analyses || analyzeData?.analyses || [];
          if (analyses.length === 0) throw new Error('No analyses returned');

          const imageAnalyses = analyses.map((a: any, idx: number) => ({
            image_index: idx,
            image_highlight: a.image_highlight || a.highlight || 'Premium living space feature',
            suggested_amenities: a.suggested_amenities || a.amenities || [],
          }));

          const existingVibe = (prop.vibe_analysis && typeof prop.vibe_analysis === 'object') ? prop.vibe_analysis as Record<string, any> : {};
          const updatedVibe: Record<string, any> = {
            ...existingVibe,
            image_analyses: imageAnalyses,
          };
          delete updatedVibe.per_image;

          const positionalHighlights = imageAnalyses.map((ia: any) => ia.image_highlight);

          const { error: updateError } = await supabase
            .from('external_properties')
            .update({
              vibe_analysis: updatedVibe,
              highlights: positionalHighlights,
            })
            .eq('id', prop.id);

          if (updateError) throw updateError;
          fixed++;
        } catch (e) {
          console.error(`[backfill] Error for ${prop.id}:`, e);
          errors++;
        }

        // Wait 3 seconds between properties to avoid OpenAI rate limits
        if (i < needsReanalysis.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }

      setBatchReanalyzeResults({ total, fixed, errors });
      setBackfillProgress(null);

      // Invalidate property discovery cache so updated vibe_analysis is served
      if (fixed > 0) {
        await supabase.functions.invoke('property-discovery-cache', {
          body: { action: 'invalidate' },
        });
        console.log('[Backfill] Property discovery cache invalidated');
      }

      toast.success(`Backfill complete! Fixed ${fixed}/${total} properties.`);
    } catch (error: any) {
      console.error('Batch re-analyze error:', error);
      toast.error("Backfill failed", { description: error.message });
    } finally {
      setIsBatchReanalyzing(false);
    }
  };

  const handleVerifyExternalListings = async () => {
    setIsVerifyingListings(true);
    setVerifyListingsResult(null);
    try {
      toast.info('Verifying external listings against source sites...');
      const { data, error } = await supabase.functions.invoke('verify-external-listings');
      if (error) throw error;
      setVerifyListingsResult(data?.summary || null);
      toast.success('Verification complete', {
        description: `Checked ${data?.summary?.checked || 0}, deactivated ${data?.summary?.deactivated || 0}.`,
      });
      refetchVerifyStats();
      refetchDeactivated();
    } catch (e: any) {
      console.error(e);
      toast.error('Verification failed', { description: e.message });
    } finally {
      setIsVerifyingListings(false);
    }
  };

  const handleReExtractPhone = async (row: { id: string; source_url: string; source: string }) => {
    setReExtractingId(row.id);
    try {
      toast.info('Re-extracting phone number…');
      const { data, error } = await supabase.functions.invoke('extract-phone', {
        body: { propertyId: row.id, sourceUrl: row.source_url, marketplace: row.source },
      });
      if (error) throw error;
      if (data?.phone) {
        toast.success(`Phone found: ${data.phone}`, { description: `via ${data.method}` });
      } else {
        toast.warning('No phone found', { description: `method: ${data?.method || 'unknown'}` });
      }
      refetchVerifyStats();
    } catch (e: any) {
      console.error(e);
      toast.error('Re-extract failed', { description: e.message });
    } finally {
      setReExtractingId(null);
    }
  };

  return (
    <div className="container mx-auto px-3 py-4 md:p-6 max-w-4xl space-y-4 md:space-y-6">

      <h1 className="text-2xl md:text-3xl font-bold">Admin Tools</h1>

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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
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
              max={10}
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

      {/* Verify External Listings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5" />
            Verify External Listings
          </CardTitle>
          <CardDescription>
            Check active external listings against their source sites (Nhatot, Batdongsan, Airbnb).
            Listings detected as removed/expired twice in a row are auto-deactivated. Runs daily via cron.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={handleVerifyExternalListings} disabled={isVerifyingListings}>
            {isVerifyingListings ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Verifying (up to 50)…</>
            ) : (
              <><RefreshCw className="h-4 w-4 mr-2" /> Verify external listings now</>
            )}
          </Button>

          {verifyListingsResult && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
              <div className="p-2 rounded border bg-muted/40"><div className="text-muted-foreground text-xs">Checked</div><div className="font-semibold">{verifyListingsResult.checked}</div></div>
              <div className="p-2 rounded border bg-muted/40"><div className="text-muted-foreground text-xs">Alive</div><div className="font-semibold text-primary">{verifyListingsResult.alive}</div></div>
              <div className="p-2 rounded border bg-muted/40"><div className="text-muted-foreground text-xs">Dead hits</div><div className="font-semibold">{verifyListingsResult.dead_increment}</div></div>
              <div className="p-2 rounded border bg-muted/40"><div className="text-muted-foreground text-xs">Deactivated</div><div className="font-semibold text-destructive">{verifyListingsResult.deactivated}</div></div>
              <div className="p-2 rounded border bg-muted/40"><div className="text-muted-foreground text-xs">Errors</div><div className="font-semibold">{verifyListingsResult.errors}</div></div>
            </div>
          )}

          {/* Recently auto-deactivated — explains WHY each listing was removed */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">
                Recently removed listings ({deactivatedListings?.length || 0})
              </Label>
              <span className="text-[10px] text-muted-foreground">Auto-deactivated after 2 failed checks</span>
            </div>
            <div className="border rounded-md divide-y max-h-80 overflow-auto">
              {(deactivatedListings || []).map((row: any) => (
                <div key={row.id} className="p-3 text-xs space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{row.title}</div>
                      <div className="text-muted-foreground flex items-center gap-1.5 mt-0.5">
                        <span className="capitalize">{row.source}</span>
                        {row.source_url && (
                          <a
                            href={row.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 text-primary hover:underline"
                          >
                            view source <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                    <Badge variant="destructive" className="text-[10px] shrink-0">removed</Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
                    <span>
                      <strong className="text-foreground">Reason:</strong> {explainVerificationReason(row.last_verification_reason)}
                    </span>
                    <span>
                      <strong className="text-foreground">Removed:</strong> {row.deactivated_at ? getTimeAgo(row.deactivated_at) : '—'}
                    </span>
                  </div>
                </div>
              ))}
              {(!deactivatedListings || deactivatedListings.length === 0) && (
                <div className="p-3 text-xs text-muted-foreground text-center">No listings have been auto-removed yet.</div>
              )}
            </div>
          </div>

          {/* Watchlist — active listings, oldest verified first, with current health */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Active watchlist (oldest verified first)</Label>
            <div className="border rounded-md divide-y max-h-80 overflow-auto">
              {(verifyStats || []).map((row: any) => {
                const status = row.last_verification_status || 'pending';
                const fails = row.verification_failures || 0;
                return (
                  <div key={row.id} className="p-2.5 text-xs space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{row.title}</div>
                        <div className="text-muted-foreground flex items-center gap-1.5 mt-0.5">
                          <span className="capitalize">{row.source}</span>
                          {row.source_url && (
                            <a
                              href={row.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-0.5 text-primary hover:underline"
                            >
                              source <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {fails > 0 && (
                          <Badge variant="destructive" className="text-[10px]">
                            {fails}/2 fails
                          </Badge>
                        )}
                        <Badge
                          variant={status === 'alive' ? 'secondary' : status === 'dead' ? 'destructive' : 'outline'}
                          className="text-[10px] capitalize"
                        >
                          {status}
                        </Badge>
                        <span className="text-muted-foreground whitespace-nowrap">
                          {row.last_verified_at ? getTimeAgo(row.last_verified_at) : 'never'}
                        </span>
                      </div>
                    </div>
                    {status !== 'alive' && row.last_verification_reason && (
                      <div className="text-muted-foreground pl-0.5">
                        <strong className="text-foreground">Last issue:</strong> {explainVerificationReason(row.last_verification_reason)}
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <div className="text-muted-foreground truncate">
                        {row.contact_phone ? (
                          <span><strong className="text-foreground">📞 {row.contact_phone}</strong></span>
                        ) : (
                          <span>No phone · {row.phone_extraction_attempts ?? 0}/3 attempts</span>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] px-2"
                        disabled={reExtractingId === row.id || (!row.contact_phone && (row.phone_extraction_attempts ?? 0) >= 3 && reExtractingId !== row.id)}
                        onClick={() => handleReExtractPhone(row)}
                      >
                        {reExtractingId === row.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Re-extract phone'}
                      </Button>
                    </div>
                  </div>
                );
              })}
              {(!verifyStats || verifyStats.length === 0) && (
                <div className="p-3 text-xs text-muted-foreground text-center">No active external listings.</div>
              )}
            </div>
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

          {backfillProgress && (
            <div className="space-y-3 p-4 bg-muted rounded-lg">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>{backfillProgress.current} of {backfillProgress.total} properties</span>
                <span>{Math.round((backfillProgress.current / backfillProgress.total) * 100)}%</span>
              </div>
              <Progress value={(backfillProgress.current / backfillProgress.total) * 100} className="h-2" />
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span className="truncate">{backfillProgress.currentTitle}</span>
              </div>
              <div className="flex gap-4 text-xs">
                <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-primary" /> {backfillProgress.fixed} fixed</span>
                <span className="flex items-center gap-1"><XCircle className="h-3 w-3 text-destructive" /> {backfillProgress.errors} errors</span>
              </div>
            </div>
          )}

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
        <CardHeader className="px-4 md:px-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base md:text-lg">
                <Clock className="h-5 w-5" />
                Auto-Crawl Schedule
                {isPaused && <Badge variant="destructive" className="text-xs">Paused</Badge>}
                {!isPaused && <Badge variant="default" className="text-xs bg-emerald-600">Active</Badge>}
              </CardTitle>
              <CardDescription className="mt-1 text-xs md:text-sm">
                Cron runs every 30 min. The function checks config and crawls the least-recently-crawled location.
              </CardDescription>
            </div>
            <Button
              variant={isPaused ? 'default' : 'destructive'}
              size="sm"
              onClick={handleTogglePause}
              disabled={isSavingConfig}
              className="shrink-0 self-start"
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
                  max={4320}
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
                  max={10}
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

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="p-3 bg-muted rounded-lg text-center">
              <p className="text-xs text-muted-foreground">Cron Interval</p>
              <p className="text-sm font-bold">Every 30 min</p>
            </div>
            <div className="p-3 bg-muted rounded-lg text-center">
              <p className="text-xs text-muted-foreground">Locations</p>
              <p className="text-sm font-bold">20 districts</p>
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
                  districts: ['District 1','District 3','District 4','District 7','District 10','Binh Thanh','Phu Nhuan','Tan Binh','Go Vap','Thu Duc'],
                },
                hanoi: {
                  label: 'Hanoi',
                  districts: ['Ba Dinh','Hoan Kiem','Dong Da','Cau Giay','Hai Ba Trung','Tay Ho','Long Bien'],
                },
                da_nang: {
                  label: 'Da Nang',
                  districts: ['Hai Chau','Son Tra','Ngu Hanh Son'],
                },
              };

              const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

              const matchesDistrict = (districtName: string, locationKey: string): boolean => {
                const norm = normalize(districtName);
                const normKey = normalize(locationKey);
                // Direct containment
                if (normKey.includes(norm) || norm.includes(normKey)) return true;
                // For "district N", also match "q N" and "quan N"
                const distMatch = norm.match(/^district (\d+)$/);
                if (distMatch) {
                  const n = distMatch[1];
                  if (normKey.includes(`district ${n}`) || normKey.includes(`q${n}`) || normKey.includes(`quan ${n}`)) return true;
                }
                return false;
              };

              const totalDistricts = Object.values(ALL_DISTRICTS).reduce((sum, c) => sum + c.districts.length, 0);
              let totalCrawled = 0;

              return (
                <div className="space-y-4">
                  {Object.entries(ALL_DISTRICTS).map(([cityKey, cityData]) => {
                    const crawledCount = cityData.districts.filter(d => {
                      if (!districtCoverage) return false;
                      for (const [key] of districtCoverage) {
                        if (matchesDistrict(d, key)) return true;
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
                            let info: { lastCrawled: string; sources: Set<string>; count: number } | null = null;
                            if (districtCoverage) {
                              for (const [key, val] of districtCoverage) {
                                if (matchesDistrict(district, key)) {
                                  // Merge if multiple location keys match the same district
                                  if (!info) {
                                    info = { ...val, sources: new Set(val.sources) };
                                  } else {
                                    val.sources.forEach(s => info!.sources.add(s));
                                    info.count += val.count;
                                    if (val.lastCrawled > info.lastCrawled) info.lastCrawled = val.lastCrawled;
                                  }
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
            <p><strong>Fake filter:</strong> Listings with price &lt;2M or &gt;200M VND, no images, sale keywords, or non-residential keywords are automatically rejected.</p>
            <p><strong>Freshness:</strong> Skips locations crawled within the cooldown period (default 48h). Listings expire after 10 days.</p>
            <p><strong>Credit saving:</strong> Search pages use direct HTTP fetch; Firecrawl credits (max 5/run) reserved for detail pages only.</p>
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
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
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
                      <div className="flex flex-wrap items-center justify-between p-2 bg-muted/50 rounded text-xs gap-1.5 sm:gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-muted-foreground whitespace-nowrap">{timeAgo}</span>
                          <Badge variant="outline" className="text-xs shrink-0">{cityLabel}</Badge>
                          <Badge variant="secondary" className="text-xs shrink-0">{run.source}</Badge>
                          
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
                              const imageCount = (prop.images || []).length;
                              // New: badge keys off vibe_status enum (set by analyze-vibe / queue consumer)
                              // when ALL images successfully produced highlights. Fallback to legacy heuristic
                              // for properties analyzed before the enum existed.
                              const vibeStatus = (prop as any).vibe_status as string | undefined;
                              const analyses =
                                (Array.isArray(vibeAnalysis?.image_analyses) && vibeAnalysis.image_analyses) ||
                                (Array.isArray(vibeAnalysis?.per_image) && vibeAnalysis.per_image) ||
                                [];
                              const legacyHasPerImage =
                                imageCount > 0 &&
                                analyses.length >= imageCount &&
                                analyses.slice(0, imageCount).every((a: any) => {
                                  const hl = String(a?.image_highlight || '').trim();
                                  const detail = String(a?.detailed_analysis || '');
                                  if (!hl || hl.length < 4) return false;
                                  if (/rate.?limit|api error|rate_limit_exceeded|analysis failed/i.test(detail)) return false;
                                  return true;
                                });
                              const hasPerImage = vibeStatus
                                ? vibeStatus === 'complete'
                                : legacyHasPerImage;
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
