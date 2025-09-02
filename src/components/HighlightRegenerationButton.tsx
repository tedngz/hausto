import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sparkles, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

export const HighlightRegenerationButton = () => {
  const [isRegenerating, setIsRegenerating] = useState(false);
  const { toast } = useToast();

  const regenerateHighlights = async () => {
    setIsRegenerating(true);
    
    try {
      toast({
        title: "Starting Regeneration",
        description: "Regenerating highlights for all properties with improved AI analysis...",
      });

      const { data, error } = await supabase.functions.invoke('regenerate-highlights', {
        body: {}
      });

      if (error) {
        throw new Error(error.message || 'Failed to regenerate highlights');
      }

      const result = data;
      
      toast({
        title: "Highlights Regenerated!",
        description: `Successfully updated ${result.summary.successful}/${result.summary.total} properties with new insightful highlights.`,
      });

      // Optionally refresh the page or emit an event to update the UI
      window.location.reload();

    } catch (error) {
      console.error('Error regenerating highlights:', error);
      toast({
        title: "Regeneration Failed",
        description: error instanceof Error ? error.message : "Failed to regenerate highlights. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsRegenerating(false);
    }
  };

  return (
    <Button
      onClick={regenerateHighlights}
      disabled={isRegenerating}
      className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
    >
      {isRegenerating ? (
        <>
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          Regenerating...
        </>
      ) : (
        <>
          <Sparkles className="w-4 h-4 mr-2" />
          Regenerate All Highlights
        </>
      )}
    </Button>
  );
};