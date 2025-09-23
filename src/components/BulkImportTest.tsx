import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { useBulkImport } from '@/hooks/useBulkImport';
import { useAuth } from '@/hooks/useAuth';

const sampleData = `[
  {
    "location": "123 Main St, New York, NY",
    "price": 2500,
    "size": "1200 sq ft",
    "images": [
      "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800",
      "https://images.unsplash.com/photo-1502005229762-cf1b2da81f8c?w=800"
    ],
    "realtor_id": "YOUR_REALTOR_ID"
  },
  {
    "location": "456 Oak Ave, Brooklyn, NY",
    "price": 1800,
    "size": "900 sq ft",
    "images": [
      "https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=800"
    ],
    "realtor_id": "YOUR_REALTOR_ID"
  }
]`;

export const BulkImportTest: React.FC = () => {
  const [jsonData, setJsonData] = useState(sampleData);
  const [lastResult, setLastResult] = useState<any>(null);
  const { bulkImportProperties, isImporting, progress, clearProgress } = useBulkImport();
  const { user } = useAuth();

  const handleImport = async () => {
    try {
      const properties = JSON.parse(jsonData);
      
      // Replace placeholder realtor_id with current user's id
      const processedProperties = properties.map((prop: any) => ({
        ...prop,
        realtor_id: prop.realtor_id === "YOUR_REALTOR_ID" ? user?.id : prop.realtor_id
      }));
      
      const result = await bulkImportProperties(processedProperties);
      setLastResult(result);
    } catch (error) {
      console.error('Import failed:', error);
    }
  };

  const progressPercentage = progress ? (progress.completed / progress.total) * 100 : 0;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Bulk Property Import</CardTitle>
          <CardDescription>
            Test the bulk import system by pasting JSON data of properties from your crawler
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">
              Property Data (JSON Array)
            </label>
            <Textarea
              value={jsonData}
              onChange={(e) => setJsonData(e.target.value)}
              placeholder="Paste your property JSON data here..."
              className="min-h-[300px] font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground mt-2">
              Replace "YOUR_REALTOR_ID" with actual realtor UUIDs from your database
            </p>
          </div>

          <div className="flex gap-4">
            <Button 
              onClick={handleImport} 
              disabled={isImporting || !jsonData.trim()}
              className="flex-1"
            >
              {isImporting ? 'Importing...' : 'Start Bulk Import'}
            </Button>
            
            {progress && (
              <Button 
                variant="outline" 
                onClick={clearProgress}
                disabled={isImporting}
              >
                Clear Progress
              </Button>
            )}
          </div>

          {progress && (
            <div className="space-y-3">
              <Progress value={progressPercentage} className="w-full" />
              <div className="flex gap-4 text-sm">
                <span>Total: {progress.total}</span>
                <span>Completed: {progress.completed}</span>
                <Badge variant="default">{progress.successful} Success</Badge>
                {progress.failed > 0 && (
                  <Badge variant="destructive">{progress.failed} Failed</Badge>
                )}
              </div>
            </div>
          )}

          {lastResult && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Import Results</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold">{lastResult.processed}</div>
                    <div className="text-sm text-muted-foreground">Processed</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">{lastResult.successful}</div>
                    <div className="text-sm text-muted-foreground">Successful</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-red-600">{lastResult.failed}</div>
                    <div className="text-sm text-muted-foreground">Failed</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold">
                      {Math.round((lastResult.successful / lastResult.processed) * 100)}%
                    </div>
                    <div className="text-sm text-muted-foreground">Success Rate</div>
                  </div>
                </div>

                {lastResult.details && lastResult.details.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-medium">Details:</h4>
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {lastResult.details.map((detail: any, index: number) => (
                        <div 
                          key={index}
                          className={`text-xs p-2 rounded ${
                            detail.status === 'success' 
                              ? 'bg-green-50 text-green-800' 
                              : 'bg-red-50 text-red-800'
                          }`}
                        >
                          <span className="font-mono">#{detail.index + 1}</span>
                          {detail.status === 'success' 
                            ? ` ✓ Property created: ${detail.id}`
                            : ` ✗ Failed: ${detail.error}`
                          }
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">How it works</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <p>1. <strong>Image Processing:</strong> Downloads images from URLs and uploads to Supabase Storage</p>
          <p>2. <strong>AI Content Generation:</strong> Uses existing vibe analysis to generate titles, descriptions, and highlights</p>
          <p>3. <strong>Database Insert:</strong> Creates properties with all generated content and metadata</p>
          <p>4. <strong>Error Handling:</strong> Continues processing even if individual properties fail</p>
        </CardContent>
      </Card>
    </div>
  );
};