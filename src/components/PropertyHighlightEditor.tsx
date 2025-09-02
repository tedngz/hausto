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
      } else {
        // Use general highlights if available
        const generalHighlights = property.vibe_analysis?.generated_content?.highlights || property.highlights || [];
        highlight = generalHighlights[index % generalHighlights.length] || `Feature ${index + 1}`;
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

  const deleteHighlight = (index: number) => {
    const updated = imageHighlights.map((h, i) => 
      i === index ? { ...h, highlight: '' } : h
    );
    setImageHighlights(updated);
  };

  const handleSave = () => {
    const highlights = imageHighlights
      .filter(h => h.highlight.trim())
      .map(h => h.highlight);
    onHighlightsUpdate(highlights);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-background">
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-xl font-bold">Property Highlights</h2>
            <p className="text-muted-foreground text-sm">AI-generated and custom highlights for each image</p>
          </div>
          <div className="flex items-center space-x-2">
            <Button
              onClick={handleRegenerateHighlights}
              disabled={isRegenerating}
              size="sm"
              variant="outline"
            >
              <Wand2 className="w-4 h-4 mr-2" />
              {isRegenerating ? 'Regenerate All' : 'Regenerate All'}
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        <div className="p-6">
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-2">AI Generated Highlights</h3>
              <p className="text-sm text-muted-foreground mb-4">Edit these highlights to match your images accurately</p>
            </div>

            {property.images && property.images.length > 0 ? (
              <div className="space-y-4">
                {property.images.map((image, index) => {
                  const imageHighlight = imageHighlights.find(h => h.imageIndex === index);
                  const isEditing = editingIndex === index;
                  
                  return (
                    <div key={index} className="flex gap-4 p-4 border rounded-lg">
                      {/* Medium-sized image */}
                      <div className="flex-shrink-0">
                        <img
                          src={image}
                          alt={`${property.title} - Image ${index + 1}`}
                          className="w-32 h-24 object-cover rounded-md"
                        />
                      </div>
                      
                      {/* Highlight content */}
                      <div className="flex-1 space-y-2">
                        {isEditing ? (
                          <div className="space-y-3">
                            <div className="flex items-center gap-2">
                              <Sparkles className="w-4 h-4 text-primary" />
                              <Label className="text-sm font-medium">Edit Highlight</Label>
                            </div>
                            <Textarea
                              value={editingText}
                              onChange={(e) => setEditingText(e.target.value)}
                              placeholder="Enter specific highlight for this image..."
                              className="text-sm"
                            />
                            <div className="flex gap-2">
                              <Button size="sm" onClick={saveEdit}>
                                <Save className="w-3 h-3 mr-1" />
                                Save
                              </Button>
                              <Button size="sm" variant="outline" onClick={cancelEdit}>Cancel</Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-2">
                                <Sparkles className="w-4 h-4 text-primary flex-shrink-0" />
                                <p 
                                  className="text-sm cursor-pointer hover:text-primary transition-colors"
                                  onClick={() => startEditing(index, imageHighlight?.highlight || '')}
                                >
                                  {imageHighlight?.highlight || 'Click to add highlight'}
                                </p>
                              </div>
                              <div className="flex items-center gap-1 ml-2">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 w-8 p-0"
                                  onClick={() => startEditing(index, imageHighlight?.highlight || '')}
                                >
                                  <Edit className="w-3 h-3" />
                                </Button>
                                {imageHighlight?.highlight && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                                    onClick={() => deleteHighlight(index)}
                                  >
                                    <X className="w-3 h-3" />
                                  </Button>
                                )}
                              </div>
                            </div>
                          </>
                        )}
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
              {imageHighlights.filter(h => h.highlight.trim()).length} of {property.images?.length || 0} images have highlights
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