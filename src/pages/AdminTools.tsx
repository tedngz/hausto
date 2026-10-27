import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, Sparkles, CheckCircle2, XCircle, Search, ShieldAlert, Activity, RefreshCw, Play, Settings2, ExternalLink, ChevronDown } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { RealtorApplicationsPanel } from "@/components/admin/RealtorApplicationsPanel";
import { FastTrackQueuePanel } from "@/components/admin/FastTrackQueuePanel";
import { RequestsOverview } from "@/components/admin/RequestsOverview";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ConciergeRequestsPanel } from "@/components/admin/ConciergeRequestsPanel";
import { ImageConflictsPanel } from "@/components/admin/ImageConflictsPanel";
import { CrawlSchedulePanel } from "@/components/admin/CrawlSchedulePanel";
import { CrawlActivityPanel } from "@/components/admin/CrawlActivityPanel";
import { CrawlNowPanel } from "@/components/admin/CrawlNowPanel";
import { CrawlerRejectionsPanel } from "@/components/admin/CrawlerRejectionsPanel";
import { OpenAIUsagePanel } from "@/components/admin/OpenAIUsagePanel";
import { withAdminSources } from "@/lib/adminListingSources";

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
  if (reason === 'browserless_paused') return 'Browserless paused';
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
  // The open tab lives in the URL (?tab=listings), so a link lands on it.
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'requests';
  const setTab = (t: string) => setParams(prev => { const n = new URLSearchParams(prev); n.set('tab', t); return n; }, { replace: true });

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

  const [isBatchReanalyzing, setIsBatchReanalyzing] = useState(false);
  const [batchReanalyzeResults, setBatchReanalyzeResults] = useState<{ total: number; fixed: number; errors: number } | null>(null);
  const [backfillProgress, setBackfillProgress] = useState<{ current: number; total: number; currentTitle: string; fixed: number; errors: number } | null>(null);
  const [mirrorRunning, setMirrorRunning] = useState(false);
  const [languageRunning, setLanguageRunning] = useState(false);
  const [mirrorResult, setMirrorResult] = useState<any>(null);
  const [mirrorStatus, setMirrorStatus] = useState<any>(null);
  const [mirrorStatusLoading, setMirrorStatusLoading] = useState(false);

  const loadMirrorStatus = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setMirrorStatusLoading(true);
      const { data, error } = await supabase.functions.invoke('mirror-status', {
        body: {},
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error) throw error;
      setMirrorStatus(data?.totals || null);
    } catch (e: any) {
      toast.error('Status check failed', { description: e?.message || String(e) });
    } finally {
      setMirrorStatusLoading(false);
    }
  }, []);

  // isAdmin is declared below; effect reads it via closure and re-runs when it flips true

  // Verify external listings state
  const [isVerifyingListings, setIsVerifyingListings] = useState(false);
  const [verifyListingsResult, setVerifyListingsResult] = useState<{ checked: number; alive: number; deactivated: number; dead_increment: number; errors: number } | null>(null);
  const [reExtractingId, setReExtractingId] = useState<string | null>(null);

  // Vibe queue depth (jobs not yet completed)
  const { data: vibeQueueStats, refetch: refetchVibeQueue } = useQuery({
    queryKey: ['vibe-queue-stats'],
    queryFn: async () => {
      const [{ count: queued }, { count: processing }, { count: failed }, { count: pendingProps }] = await Promise.all([
        supabase.from('vibe_analysis_queue').select('id', { count: 'exact', head: true }).eq('status', 'queued'),
        supabase.from('vibe_analysis_queue').select('id', { count: 'exact', head: true }).eq('status', 'processing'),
        supabase.from('vibe_analysis_queue').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
        supabase.from('external_properties').select('id', { count: 'exact', head: true }).neq('vibe_status', 'complete'),
      ]);
      return {
        queued: queued || 0,
        processing: processing || 0,
        failed: failed || 0,
        pendingProperties: pendingProps || 0,
      };
    },
    refetchInterval: 15000,
  });

  const [previewProperty, setPreviewProperty] = useState<any>(null);

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

  useEffect(() => {
    if (user && isAdmin) loadMirrorStatus();
  }, [user, isAdmin, loadMirrorStatus]);

  // Verify external listings (must be before any early return to keep hook order stable)
  const { data: verifyStats, refetch: refetchVerifyStats } = useQuery({
    queryKey: ['external-verify-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('external_properties')
        .select('id, title, source, last_verified_at, last_verification_status, last_verification_reason, verification_failures, phone_extraction_attempts')
        .eq('is_active', true)
        .order('last_verified_at', { ascending: true, nullsFirst: true })
        .limit(20);
      if (error) throw error;
      const rows = await withAdminSources(data || []);
      if (rows.length > 0) {
        const { data: contacts } = await supabase.rpc('get_external_property_contacts', {
          _property_ids: rows.map((r: any) => r.id),
        });
        const phoneMap = new Map<string, string | null>((contacts || []).map((c: any) => [c.id, c.contact_phone]));
        return rows.map((r: any) => ({ ...r, contact_phone: phoneMap.get(r.id) ?? null }));
      }
      return rows;
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
        .select('id, title, source, deactivated_at, last_verification_reason, verification_failures, last_verified_at')
        .eq('is_active', false)
        .not('deactivated_at', 'is', null)
        .order('deactivated_at', { ascending: false })
        .limit(15);
      if (error) throw error;
      return withAdminSources(data || []);
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
    <div className="container mx-auto px-3 py-4 md:p-6 max-w-6xl space-y-4 md:space-y-6">

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl md:text-3xl font-bold">Admin Tools</h1>
        <Button variant="outline" size="sm" onClick={() => navigate('/admin/complexes')}>
          <Settings2 className="mr-1 h-4 w-4" /> Complex Catalog
        </Button>
      </div>


      {/* Grouped by what the work is (2026-10-08). Requests first: they are
          what a person acts on today; the rest is the platform behind them. */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="requests">Requests</TabsTrigger>
          <TabsTrigger value="listings">Listings &amp; crawling</TabsTrigger>
          <TabsTrigger value="ai">AI &amp; search</TabsTrigger>
          <TabsTrigger value="agents">Agents</TabsTrigger>
        </TabsList>

        <TabsContent value="requests" className="mt-4 space-y-4">
          <RequestsOverview />
          {/* Retired surfaces whose rows are still real history. */}
          <Collapsible>
            <CollapsibleTrigger className="group flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
              <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
              Older request systems - Fast-Track and email availability requests
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 space-y-4">
              <FastTrackQueuePanel />
              <ConciergeRequestsPanel />
            </CollapsibleContent>
          </Collapsible>
        </TabsContent>

        <TabsContent value="listings" className="mt-4 space-y-4 md:space-y-6">
          {/* Ordered by how often each is touched (2026-10-15): the schedule
              first, then what it did, then the review queue it feeds. One-off
              crawls and verification below; maintenance folded away. */}
          <CrawlSchedulePanel />
          <CrawlActivityPanel onPreview={setPreviewProperty} />
          <ImageConflictsPanel />
          <CrawlNowPanel />

        {/* Verify External Listings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5" />
              Verify External Listings
            </CardTitle>
            <CardDescription>
              Checks live listings against their source ads, oldest-checked first. A listing found removed or
              expired twice in a row is taken down. The cron runs every 20 minutes, 25 listings at a time.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={handleVerifyExternalListings} disabled={isVerifyingListings}>
              {isVerifyingListings ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Verifying (up to 25)…</>
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

          <CrawlerRejectionsPanel />

          <Collapsible>
            <CollapsibleTrigger className="group flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
              <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
              Maintenance - image mirroring, translation, highlight backfill
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 space-y-4 md:space-y-6">
          {/* Mirror crawled images to Supabase Storage */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                Mirror Crawled Images to Storage
              </CardTitle>
              <CardDescription>
                Downloads remote CDN images on external listings into the <code>external-property-images</code> bucket so they survive source-listing removal. "Mirror Everything" loops until done (incl. raw + inactive).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Mirror progress status */}
              <div className="p-4 rounded-lg border bg-card space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-semibold text-sm">Mirror Progress</h4>
                  <Button size="sm" variant="ghost" onClick={loadMirrorStatus} disabled={mirrorStatusLoading}>
                    {mirrorStatusLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  </Button>
                </div>
                {!mirrorStatus && !mirrorStatusLoading && (
                  <p className="text-xs text-muted-foreground">No data yet.</p>
                )}
                {mirrorStatus && (
                  <>
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">Images mirrored</span>
                        <span className="font-medium">{mirrorStatus.mirrored_images} / {mirrorStatus.total_images} ({mirrorStatus.mirrored_pct}%)</span>
                      </div>
                      <Progress value={mirrorStatus.mirrored_pct} className="h-2" />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div className="p-2 rounded bg-muted">
                        <div className="text-muted-foreground">Listings w/ images</div>
                        <div className="font-semibold text-sm">{mirrorStatus.rows_with_images}</div>
                      </div>
                      <div className="p-2 rounded bg-muted">
                        <div className="text-muted-foreground">Active listings</div>
                        <div className="font-semibold text-sm">{mirrorStatus.active_rows}</div>
                      </div>
                      <div className="p-2 rounded bg-muted">
                        <div className="text-muted-foreground">Rows w/ remote URLs</div>
                        <div className="font-semibold text-sm">{mirrorStatus.rows_with_unmirrored}</div>
                      </div>
                      <div className="p-2 rounded bg-muted">
                        <div className="text-muted-foreground">Active rows pending</div>
                        <div className={`font-semibold text-sm ${mirrorStatus.active_rows_with_unmirrored === 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                          {mirrorStatus.active_rows_with_unmirrored}
                        </div>
                      </div>
                    </div>
                    {mirrorStatus.active_rows_with_unmirrored === 0 && mirrorStatus.remote_images > 0 && (
                      <p className="text-xs text-emerald-600">All active listings fully mirrored. Remaining {mirrorStatus.remote_images} remote images are on inactive/raw rows.</p>
                    )}
                    {mirrorStatus.remote_images === 0 && (
                      <p className="text-xs text-emerald-600">Every crawled image is mirrored to storage.</p>
                    )}
                  </>
                )}
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  onClick={async () => {
                    try {
                      setMirrorRunning(true);
                      let totalProcessed = 0;
                      let rounds = 0;
                      let idleStreak = 0;
                      const maxRounds = 1000;
                      while (rounds < maxRounds) {
                        rounds++;
                        const { data, error } = await supabase.functions.invoke('backfill-external-images', {
                          body: { batchSize: 10, includeRaw: true, includeInactive: true },
                        });
                        if (error) throw error;
                        const processed = Number(data?.processed ?? 0);
                        const bumped = Number(data?.bumped_already_done ?? 0);
                        totalProcessed += processed;
                        setMirrorResult({ ...data, totalProcessed, rounds });
                        // Truly done only when there's nothing left to mirror AND
                        // nothing left to advance past (cursor exhausted).
                        if (processed === 0 && bumped === 0) {
                          idleStreak++;
                          if (idleStreak >= 2) break;
                        } else {
                          idleStreak = 0;
                        }
                        if (rounds % 5 === 0) loadMirrorStatus();
                        await new Promise((r) => setTimeout(r, 250));
                      }
                      await loadMirrorStatus();
                      toast.success(`Mirror Remaining done — ${totalProcessed} listings across ${rounds} rounds`);
                    } catch (e: any) {
                      toast.error('Mirror failed', { description: e?.message || String(e) });
                    } finally {
                      setMirrorRunning(false);
                    }
                  }}
                  disabled={mirrorRunning || (mirrorStatus && mirrorStatus.remote_images === 0)}
                  size="lg"
                  className="w-full"
                >
                  {mirrorRunning ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Mirroring remaining...</>
                  ) : (
                    <><Sparkles className="mr-2 h-4 w-4" />Mirror Remaining{mirrorStatus ? ` (${mirrorStatus.remote_images.toLocaleString()} images / ${mirrorStatus.rows_with_unmirrored} listings)` : ''}</>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      setMirrorRunning(true);
                      const { data, error } = await supabase.functions.invoke('backfill-external-images', { body: { batchSize: 10, includeRaw: false, includeInactive: false } });
                      if (error) throw error;
                      setMirrorResult(data);
                      toast.success(`Mirrored ${data?.processed ?? 0} listings`);
                    } catch (e: any) {
                      toast.error('Mirror failed', { description: e?.message || String(e) });
                    } finally {
                      setMirrorRunning(false);
                    }
                  }}
                  disabled={mirrorRunning}
                  size="lg"
                  className="w-full"
                >
                  Active Processed Only
                </Button>
                <Button
                  variant="destructive"
                  onClick={async () => {
                    if (!confirm('Repair listings whose mirrored images collided with other listings?\n\nThis will:\n• Restore images from raw_data.original_image_urls when available\n• Otherwise hide the listing and mark it for re-crawl')) return;
                    try {
                      setMirrorRunning(true);
                      const { data, error } = await supabase.functions.invoke('backfill-external-images', { body: { action: 'repair-collisions' } });
                      if (error) throw error;
                      setMirrorResult(data);
                      toast.success(`Repair done — restored ${data?.rows_restored_from_raw_data ?? 0}, cleared ${data?.rows_cleared_for_recrawl ?? 0}`);
                      await loadMirrorStatus();
                    } catch (e: any) {
                      toast.error('Repair failed', { description: e?.message || String(e) });
                    } finally {
                      setMirrorRunning(false);
                    }
                  }}
                  disabled={mirrorRunning}
                  size="lg"
                  className="w-full"
                >
                  Repair Collisions
                </Button>
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      setLanguageRunning(true);
                      const { data, error } = await supabase.functions.invoke('backfill-listing-language', { body: { batchSize: 20 } });
                      if (error) throw error;
                      setMirrorResult(data);
                      toast.success(
                        `Rewrote ${data?.rewritten ?? 0} listing(s) in English`,
                        { description: `${data?.remaining ?? 0} still to go` },
                      );
                    } catch (e: any) {
                      toast.error('Translation backfill failed', { description: e?.message || String(e) });
                    } finally {
                      setLanguageRunning(false);
                    }
                  }}
                  disabled={languageRunning}
                  size="lg"
                  className="w-full"
                >
                  {languageRunning ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Rewriting in English...</>
                  ) : (
                    'Translate Vietnamese Listings'
                  )}
                </Button>
              </div>
              {mirrorResult && (
                <div className="p-4 bg-muted rounded-lg text-sm space-y-1">
                  {mirrorResult.totalProcessed !== undefined && (
                    <p>Total mirrored so far: <span className="font-semibold">{mirrorResult.totalProcessed}</span> (round {mirrorResult.rounds})</p>
                  )}
                  <p>Last batch processed: <span className="font-semibold">{mirrorResult.processed}</span></p>
                  <p>Remaining candidates this run: <span className="font-semibold">{mirrorResult.remaining_candidates}</span></p>
                </div>
              )}
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
            </CollapsibleContent>
          </Collapsible>
        </TabsContent>

        <TabsContent value="ai" className="mt-4 space-y-4 md:space-y-6">
          <OpenAIUsagePanel />

        {/* Vibe Analysis Queue */}
        <Card>
          <CardHeader className="px-4 md:px-6">
            <CardTitle className="flex items-center gap-2 text-base md:text-lg">
              <Activity className="h-5 w-5" />
              Vibe Analysis Queue
            </CardTitle>
            <CardDescription className="text-xs md:text-sm">
              Background processor for per-image vibe analysis. Listings only become discoverable once <code>vibe_status = complete</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4 md:px-6 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Queued</div>
                <div className="text-2xl font-semibold">{vibeQueueStats?.queued ?? '—'}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Processing</div>
                <div className="text-2xl font-semibold">{vibeQueueStats?.processing ?? '—'}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Failed</div>
                <div className="text-2xl font-semibold text-destructive">{vibeQueueStats?.failed ?? '—'}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Properties pending</div>
                <div className="text-2xl font-semibold">{vibeQueueStats?.pendingProperties ?? '—'}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  const t = toast.loading('Processing vibe queue batch...');
                  try {
                    const { data, error } = await supabase.functions.invoke('process-vibe-queue', { body: { batchSize: 4 } });
                    if (error) throw error;
                    toast.success(`Processed ${data?.processed ?? 0}, completed ${data?.completed ?? 0}`, { id: t });
                    refetchVibeQueue();
                  } catch (e: any) {
                    toast.error(`Queue run failed: ${e.message}`, { id: t });
                  }
                }}
              >
                <Play className="h-4 w-4 mr-1" />
                Process batch now
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  const t = toast.loading('Finding listings with missing highlights...');
                  try {
                    const { data, error } = await supabase.functions.invoke('backfill-image-highlights', {
                      body: { limit: 200, requeue_only: true, missing_only: true },
                    });
                    if (error) throw error;
                    const enq = data?.enqueued ?? 0;
                    const total = data?.total ?? 0;
                    const skipped = data?.skippedBelowFloor ?? 0;
                    toast.success(
                      total === 0
                        ? 'No listings with missing highlights found'
                        : `Enqueued ${enq} of ${total} listings missing highlights` +
                          (skipped > 0 ? ` · ${skipped} below the image floor, run the backfill directly for those` : ''),
                      { id: t }
                    );
                    refetchVibeQueue();
                  } catch (e: any) {
                    toast.error(`Requeue failed: ${e.message}`, { id: t });
                  }
                }}
              >
                <RefreshCw className="h-4 w-4 mr-1" />
                Re-enqueue missing highlights
              </Button>
            </div>
          </CardContent>
        </Card>

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
        </TabsContent>

        <TabsContent value="agents" className="mt-4 space-y-4">
          <RealtorApplicationsPanel />
        </TabsContent>
      </Tabs>

      {/* Property Preview Dialog */}
      <Dialog open={!!previewProperty} onOpenChange={(open) => !open && setPreviewProperty(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {previewProperty && (() => {
            const vibeAnalysis = previewProperty.vibe_analysis as any;
            // image_analyses is the current shape; per_image is what listings
            // analysed before it still carry.
            const perImage = vibeAnalysis?.image_analyses || vibeAnalysis?.per_image || [];
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
                          <img loading="lazy"
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
                      <p className="font-medium">{Number(previewProperty.price_vnd) ? `${Math.round(Number(previewProperty.price_vnd) / 100_000) / 10}M ₫` : 'N/A'}</p>
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
    </div>
  );
};

export default AdminTools;
