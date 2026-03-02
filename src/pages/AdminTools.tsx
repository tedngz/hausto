import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, Sparkles, CheckCircle2, XCircle, Search, Globe, ShieldAlert } from "lucide-react";
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

  // Check admin role from user_roles table (must be before any early returns)
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

      const { data, error } = await supabase.functions.invoke('crawl-external-properties', {
        body: {
          city: crawlCity,
          marketplaces: selectedMarketplaces,
          forceRefresh: crawlForceRefresh,
          storeInDatabase: true,
          runVibeAnalysis: crawlRunVibe,
        }
      });

      if (error) throw error;

      setCrawlResults(data);
      toast.success("Crawl complete!", {
        description: `Found: ${data.totalFound}, Stored: ${data.totalStored}, Vibe Analyzed: ${data.totalVibeAnalyzed}`
      });
    } catch (error: any) {
      console.error('Crawl error:', error);
      toast.error("Crawl failed", { description: error.message });
    } finally {
      setIsCrawling(false);
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

          <Button
            onClick={handleCrawlListings}
            disabled={isCrawling}
            size="lg"
            className="w-full"
          >
            {isCrawling ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Crawling Listings...
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
              <div className="grid grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Found</p>
                  <p className="text-2xl font-bold">{crawlResults.totalFound}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Stored</p>
                  <p className="text-2xl font-bold text-green-600">{crawlResults.totalStored}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Vibe Analyzed</p>
                  <p className="text-2xl font-bold">{crawlResults.totalVibeAnalyzed}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Skipped</p>
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
