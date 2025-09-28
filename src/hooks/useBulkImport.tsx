import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface CrawledProperty {
  location: string;
  price: number;
  size?: string;
  images: string[]; // URLs to images
  realtor_id: string;
  // Optional fields that will be auto-generated if not provided
  title?: string;
  description?: string;
  vibe?: string;
  highlights?: string[];
  property_source_link?: string;
}

interface BulkImportResult {
  success: boolean;
  processed: number;
  successful: number;
  failed: number;
  details: Array<{
    index: number;
    status: 'success' | 'failed';
    id?: string;
    error?: string;
  }>;
}

export const useBulkImport = () => {
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState<{
    total: number;
    completed: number;
    successful: number;
    failed: number;
  } | null>(null);

  const bulkImportProperties = async (properties: CrawledProperty[]): Promise<BulkImportResult> => {
    setIsImporting(true);
    setProgress({
      total: properties.length,
      completed: 0,
      successful: 0,
      failed: 0
    });

    try {
      console.log(`Starting bulk import of ${properties.length} properties`);
      
      // Process properties in batches to avoid timeouts and provide better progress tracking
      const batchSize = 3; // Process 3 properties at a time
      const batches: CrawledProperty[][] = [];
      
      for (let i = 0; i < properties.length; i += batchSize) {
        batches.push(properties.slice(i, i + batchSize));
      }

      let totalSuccessful = 0;
      let totalFailed = 0;
      const allResults: Array<{
        index: number;
        status: 'success' | 'failed';
        id?: string;
        error?: string;
      }> = [];

      // Process each batch sequentially with progress updates
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        const startIndex = batchIndex * batchSize;
        
        console.log(`Processing batch ${batchIndex + 1}/${batches.length} (properties ${startIndex + 1}-${startIndex + batch.length})`);
        
        try {
          const { data: batchResult, error: batchError } = await supabase.functions.invoke('bulk-import-properties', {
            body: { 
              properties: batch,
              startIndex // Pass the starting index for proper result mapping
            }
          });

          if (batchError) {
            console.error(`Batch ${batchIndex + 1} error:`, batchError);
            // Mark all properties in this batch as failed
            for (let i = 0; i < batch.length; i++) {
              allResults.push({
                index: startIndex + i,
                status: 'failed',
                error: batchError.message
              });
              totalFailed++;
            }
          } else if (batchResult) {
            const result = batchResult as BulkImportResult;
            totalSuccessful += result.successful;
            totalFailed += result.failed;
            
            // Adjust result indices to match overall property list
            const adjustedResults = result.details.map(detail => ({
              ...detail,
              index: startIndex + detail.index
            }));
            allResults.push(...adjustedResults);
          }
        } catch (error) {
          console.error(`Batch ${batchIndex + 1} failed:`, error);
          // Mark all properties in this batch as failed
          for (let i = 0; i < batch.length; i++) {
            allResults.push({
              index: startIndex + i,
              status: 'failed',
              error: error instanceof Error ? error.message : 'Unknown error'
            });
            totalFailed++;
          }
        }

        // Update progress after each batch
        const completed = (batchIndex + 1) * batchSize;
        setProgress({
          total: properties.length,
          completed: Math.min(completed, properties.length),
          successful: totalSuccessful,
          failed: totalFailed
        });

        // Small delay to prevent overwhelming the system
        if (batchIndex < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      const finalResult: BulkImportResult = {
        success: totalSuccessful > 0,
        processed: properties.length,
        successful: totalSuccessful,
        failed: totalFailed,
        details: allResults
      };

      // Final progress update
      setProgress({
        total: properties.length,
        completed: properties.length,
        successful: totalSuccessful,
        failed: totalFailed
      });

      // Show success/failure summary
      if (totalSuccessful > 0) {
        toast.success(`Successfully imported ${totalSuccessful} properties`);
      }
      
      if (totalFailed > 0) {
        toast.error(`Failed to import ${totalFailed} properties`);
        
        // Log failed properties for debugging
        const failedProperties = allResults
          .filter(detail => detail.status === 'failed')
          .map(detail => ({
            index: detail.index,
            location: properties[detail.index]?.location,
            error: detail.error
          }));
        
        console.error('Failed properties:', failedProperties);
      }

      return finalResult;

    } catch (error) {
      console.error('Bulk import error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      toast.error(`Bulk import failed: ${errorMessage}`);
      
      throw error;
    } finally {
      setIsImporting(false);
    }
  };

  const clearProgress = () => {
    setProgress(null);
  };

  return {
    bulkImportProperties,
    isImporting,
    progress,
    clearProgress
  };
};