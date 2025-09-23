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
      
      const { data: result, error } = await supabase.functions.invoke('bulk-import-properties', {
        body: { properties }
      });

      if (error) {
        throw new Error(error.message);
      }

      const importResult = result as BulkImportResult;
      
      setProgress({
        total: importResult.processed,
        completed: importResult.processed,
        successful: importResult.successful,
        failed: importResult.failed
      });

      // Show success/failure summary
      if (importResult.successful > 0) {
        toast.success(`Successfully imported ${importResult.successful} properties`);
      }
      
      if (importResult.failed > 0) {
        toast.error(`Failed to import ${importResult.failed} properties`);
        
        // Log failed properties for debugging
        const failedProperties = importResult.details
          .filter(detail => detail.status === 'failed')
          .map(detail => ({
            index: detail.index,
            location: properties[detail.index]?.location,
            error: detail.error
          }));
        
        console.error('Failed properties:', failedProperties);
      }

      return importResult;

    } catch (error) {
      console.error('Bulk import error:', error);
      toast.error(`Bulk import failed: ${error.message}`);
      
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