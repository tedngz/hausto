import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, Sparkles, CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const AdminTools = () => {
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

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <h1 className="text-3xl font-bold mb-6">Admin Tools</h1>
      
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
    </div>
  );
};

export default AdminTools;
