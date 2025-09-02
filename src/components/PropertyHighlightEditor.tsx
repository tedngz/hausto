import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Wand2, Save, X, Edit, Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Property } from '@/hooks/useProperties';

interface ImageHighlight {
  imageIndex: number;
  highlight: string;
}

interface PropertyHighlightEditorProps {
  property: Property;
  isOpen: boolean;
  onHighlightsUpdate: (highlights: string[]) => void;
  onClose: () => void;
}

export const PropertyHighlightEditor = ({ 
  property, 
  isOpen,
  onHighlightsUpdate, 
  onClose 
}: PropertyHighlightEditorProps) => {
  // Initialize with image-specific highlights from AI analysis
  const [imageHighlights, setImageHighlights] = useState<ImageHighlight[]>(() => {
    if (!property.images) return [];
    
    return property.images.map((_, index) => {
      const imageAnalyses = property.vibe_analysis?.image_analyses || [];
      const analysisForImage = imageAnalyses.find(a => a.image_index === index);
      
      // Get AI-generated highlight for this image or fallback
      let highlight = '';
      if (analysisForImage?.image_highlight) {
        highlight = analysisForImage.image_highlight;
      } else if (analysisForImage?.detailed_analysis && typeof analysisForImage.detailed_analysis === 'string') {
        // Extract feature from detailed analysis (only if it's a string)
        const analysis = analysisForImage.detailed_analysis.toLowerCase();
        if (analysis.includes('kitchen') && analysis.includes('modern')) {
          highlight = 'Modern equipped kitchen';
        } else if (analysis.includes('bathroom') && analysis.includes('luxury')) {
          highlight = 'Luxurious bathroom facilities';
        } else if (analysis.includes('bedroom') && analysis.includes('spacious')) {
          highlight = 'Spacious bedroom design';
        } else if (analysis.includes('living') && analysis.includes('open')) {
          highlight = 'Open plan living space';
        } else if (analysis.includes('natural light') || analysis.includes('bright')) {
          highlight = 'Abundant natural light';
        } else {
          highlight = 'Beautiful interior feature';
        }
      } else {
        // Use general highlights if available
        const generalHighlights = property.vibe_analysis?.generated_content?.highlights || property.highlights || [];
        highlight = generalHighlights[index % generalHighlights.length] || 'Notable feature';
      }
      
      return { imageIndex: index, highlight };
    });
  });
  
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');
  const { toast } = useToast();

  const handleRegenerateHighlights = async () => {
    if (!property.images || property.images.length === 0) {
      toast({
        title: "No Images",
        description: "Property needs images to generate highlights.",
        variant: "destructive"
      });
      return;
    }

    setIsRegenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-vibe', {
        body: {
          imageUrls: property.images,
          property_info: {
            title: property.title,
            description: property.description,
            location: property.location,
            price: property.price,
            size: property.size
          },
          generateContent: true
        }
      });

      if (error) throw error;

      if (data?.vibe_analysis?.image_analyses) {
        // Create new highlights from image-specific analysis
        const newHighlights = property.images.map((_, index) => {
          const analysisForImage = data.vibe_analysis.image_analyses.find((a: any) => a.image_index === index);
          return {
            imageIndex: index,
            highlight: analysisForImage?.image_highlight || `Feature ${index + 1}`
          };
        });
        
        setImageHighlights(newHighlights);
        toast({
          title: "Highlights Generated",
          description: "AI has generated new image-specific highlights.",
        });
      }
    } catch (error) {
      console.error('Error regenerating highlights:', error);
      toast({
        title: "Generation Failed",
        description: "Could not generate new highlights. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsRegenerating(false);
    }
  };

  const startEditing = (index: number, currentText: string) => {
    setEditingIndex(index);
    setEditingText(currentText);
  };

  const saveEdit = () => {
    if (editingIndex !== null && editingText.trim()) {
      const updated = imageHighlights.map((h, i) => 
        i === editingIndex ? { ...h, highlight: editingText.trim() } : h
      );
      setImageHighlights(updated);
      setEditingIndex(null);
      setEditingText('');
    }
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setEditingText('');
  };

  const handleSave = () => {
    const highlights = imageHighlights
      .filter(h => h.highlight.trim())
      .map(h => h.highlight);
    onHighlightsUpdate(highlights);
    onClose();
  };

  if (!isOpen) return null;

  const validHighlights = imageHighlights.filter(h => h.highlight.trim());

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-background">
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-xl font-bold">Image Highlights Editor</h2>
            <p className="text-muted-foreground text-sm">Each image has one specific highlight that captures its most notable feature</p>
          </div>
          <div className="flex items-center space-x-2">
            <Button
              onClick={handleRegenerateHighlights}
              disabled={isRegenerating}
              size="sm"
              variant="outline"
            >
              <Wand2 className="w-4 h-4 mr-2" />
              {isRegenerating ? 'Generating...' : 'Regenerate All'}
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        <div className="p-6">
          {/* Image Grid with Highlights */}
          <div className="space-y-6">
            {property.images && property.images.length > 0 ? (
              <div className="space-y-4">
                {property.images.map((image, index) => {
                  const imageHighlight = imageHighlights.find(h => h.imageIndex === index);
                  const isEditing = editingIndex === index;
                  
                  return (
                    <div key={index} className="border rounded-lg p-4 bg-background">
                      <div className="flex gap-4">
                        {/* Image */}
                        <div className="relative w-48 h-32 flex-shrink-0">
                          <img
                            src={image}
                            alt={`Property image ${index + 1}`}
                            className="w-full h-full object-cover rounded-lg"
                          />
                          <div className="absolute top-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded">
                            #{index + 1}
                          </div>
                        </div>
                        
                        {/* Highlight */}
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-primary" />
                            <Label className="font-medium">Image Highlight</Label>
                          </div>
                          
                          {isEditing ? (
                            <div className="space-y-2">
                              <Textarea
                                value={editingText}
                                onChange={(e) => setEditingText(e.target.value)}
                                placeholder="Enter specific highlight for this image..."
                                className="min-h-[60px]"
                              />
                              <div className="flex gap-2">
                                <Button size="sm" onClick={saveEdit}>Save</Button>
                                <Button size="sm" variant="outline" onClick={cancelEdit}>Cancel</Button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between">
                              <Badge 
                                variant="secondary" 
                                className="text-sm px-3 py-1 cursor-pointer hover:bg-secondary/80"
                                onClick={() => startEditing(index, imageHighlight?.highlight || '')}
                              >
                                {imageHighlight?.highlight || 'Click to add highlight'}
                              </Badge>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => startEditing(index, imageHighlight?.highlight || '')}
                              >
                                <Edit className="w-3 h-3" />
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p>No images available</p>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex justify-between items-center pt-6 border-t mt-6">
            <div className="text-sm text-muted-foreground">
              {validHighlights.length} of {property.images?.length || 0} images have highlights
            </div>
            <div className="flex space-x-3">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleSave}>
                <Save className="w-4 h-4 mr-2" />
                Save Highlights
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};