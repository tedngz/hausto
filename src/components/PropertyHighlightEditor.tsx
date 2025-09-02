import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Wand2, Save, X, Plus, Trash2, Image, Eye, EyeOff } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Property } from '@/hooks/useProperties';

interface HighlightWithImages {
  text: string;
  associatedImages: number[];
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
  const [highlightsWithImages, setHighlightsWithImages] = useState<HighlightWithImages[]>(() => {
    const currentHighlights = property.vibe_analysis?.generated_content?.highlights || property.highlights || [];
    return currentHighlights.map(text => ({
      text,
      associatedImages: []
    }));
  });
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [newHighlight, setNewHighlight] = useState('');
  const [selectedHighlight, setSelectedHighlight] = useState<number | null>(null);
  const [showPreview, setShowPreview] = useState(true);
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
          property_id: property.id,
          images: property.images,
          property_info: {
            title: property.title,
            description: property.description,
            location: property.location,
            price: property.price,
            size: property.size
          },
          generate_content: true
        }
      });

      if (error) throw error;

      if (data?.vibe_analysis?.generated_content?.highlights) {
        const newHighlights = data.vibe_analysis.generated_content.highlights;
        setHighlightsWithImages(newHighlights.map((text: string) => ({
          text,
          associatedImages: []
        })));
        toast({
          title: "Highlights Generated",
          description: "AI has generated new property highlights. Associate them with images below.",
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

  const addHighlight = () => {
    if (newHighlight.trim()) {
      setHighlightsWithImages([...highlightsWithImages, {
        text: newHighlight.trim(),
        associatedImages: []
      }]);
      setNewHighlight('');
    }
  };

  const removeHighlight = (index: number) => {
    setHighlightsWithImages(highlightsWithImages.filter((_, i) => i !== index));
    if (selectedHighlight === index) setSelectedHighlight(null);
  };

  const updateHighlight = (index: number, value: string) => {
    const updated = highlightsWithImages.map((h, i) => 
      i === index ? { ...h, text: value } : h
    );
    setHighlightsWithImages(updated);
  };

  const toggleImageAssociation = (highlightIndex: number, imageIndex: number) => {
    const updated = highlightsWithImages.map((h, i) => {
      if (i === highlightIndex) {
        const associated = h.associatedImages.includes(imageIndex);
        return {
          ...h,
          associatedImages: associated 
            ? h.associatedImages.filter(idx => idx !== imageIndex)
            : [...h.associatedImages, imageIndex]
        };
      }
      return h;
    });
    setHighlightsWithImages(updated);
  };

  const handleSave = () => {
    const validHighlights = highlightsWithImages
      .filter(h => h.text.trim() && h.associatedImages.length > 0)
      .map(h => h.text);
    onHighlightsUpdate(validHighlights);
    onClose();
  };

  if (!isOpen) return null;

  const validHighlights = highlightsWithImages.filter(h => h.text.trim() && h.associatedImages.length > 0);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-5xl max-h-[90vh] overflow-y-auto bg-background">
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-xl font-bold">Smart Highlight Editor</h2>
            <p className="text-muted-foreground text-sm">Associate highlights with specific images for accurate representation</p>
          </div>
          <div className="flex items-center space-x-2">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setShowPreview(!showPreview)}
            >
              {showPreview ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        <div className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left Column - Highlights Management */}
            <div className="space-y-6">
              {/* AI Regeneration */}
              <div className="flex items-center justify-between p-4 bg-gradient-to-r from-primary/10 to-secondary/10 rounded-lg border">
                <div>
                  <h3 className="font-medium">AI-Generated Highlights</h3>
                  <p className="text-sm text-muted-foreground">Generate new highlights from your images</p>
                </div>
                <Button
                  onClick={handleRegenerateHighlights}
                  disabled={isRegenerating}
                  size="sm"
                >
                  <Wand2 className="w-4 h-4 mr-2" />
                  {isRegenerating ? 'Generating...' : 'Generate'}
                </Button>
              </div>

              {/* Highlights List */}
              <div>
                <Label className="text-base font-semibold">Highlights</Label>
                <div className="space-y-3 mt-3">
                  {highlightsWithImages.map((highlight, index) => (
                    <div 
                      key={index} 
                      className={`p-3 border rounded-lg transition-all ${
                        selectedHighlight === index ? 'border-primary bg-primary/5' : ''
                      }`}
                    >
                      <div className="flex items-start space-x-3">
                        <Textarea
                          value={highlight.text}
                          onChange={(e) => updateHighlight(index, e.target.value)}
                          className="flex-1 min-h-[40px] resize-none"
                          placeholder="Enter highlight description..."
                          onClick={() => setSelectedHighlight(index)}
                        />
                        <div className="flex flex-col items-center space-y-2">
                          <Badge variant="outline" className="text-xs">
                            {highlight.associatedImages.length} images
                          </Badge>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => removeHighlight(index)}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                  
                  {highlightsWithImages.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                      <p>No highlights yet. Add some or generate with AI.</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Add New Highlight */}
              <div>
                <Label className="text-base font-semibold">Add New Highlight</Label>
                <div className="flex items-center space-x-3 mt-3">
                  <Textarea
                    value={newHighlight}
                    onChange={(e) => setNewHighlight(e.target.value)}
                    placeholder="Enter a new highlight..."
                    className="flex-1 min-h-[40px] resize-none"
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        addHighlight();
                      }
                    }}
                  />
                  <Button
                    onClick={addHighlight}
                    disabled={!newHighlight.trim()}
                    size="sm"
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Right Column - Image Association */}
            <div className="space-y-6">
              {/* Image Gallery */}
              <div>
                <Label className="text-base font-semibold">Associate Images</Label>
                {selectedHighlight !== null && (
                  <p className="text-sm text-muted-foreground mt-1">
                    Select images for: "{highlightsWithImages[selectedHighlight]?.text.substring(0, 40)}..."
                  </p>
                )}
                
                {property.images && property.images.length > 0 ? (
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    {property.images.map((image, imageIndex) => (
                      <div key={imageIndex} className="relative group">
                        <img
                          src={image}
                          alt={`Property image ${imageIndex + 1}`}
                          className="w-full h-24 object-cover rounded-lg border"
                        />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                          <span className="text-white text-sm font-medium">#{imageIndex + 1}</span>
                        </div>
                        
                        {/* Association checkboxes for each highlight */}
                        <div className="absolute top-2 right-2 flex flex-col space-y-1">
                          {highlightsWithImages.map((highlight, highlightIndex) => (
                            <div
                              key={highlightIndex}
                              className={`w-5 h-5 rounded border-2 cursor-pointer transition-all ${
                                highlight.associatedImages.includes(imageIndex)
                                  ? 'bg-primary border-primary'
                                  : 'bg-background border-border'
                              } ${selectedHighlight === highlightIndex ? 'ring-2 ring-primary/50' : ''}`}
                              onClick={() => toggleImageAssociation(highlightIndex, imageIndex)}
                              title={`Associate with: ${highlight.text.substring(0, 30)}${highlight.text.length > 30 ? '...' : ''}`}
                            >
                              {highlight.associatedImages.includes(imageIndex) && (
                                <div className="w-full h-full flex items-center justify-center">
                                  <div className="w-2 h-2 bg-primary-foreground rounded-full" />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Image className="w-12 h-12 mx-auto mb-2" />
                    <p>No images available for association</p>
                  </div>
                )}
              </div>

              {/* Preview */}
              {showPreview && validHighlights.length > 0 && (
                <div>
                  <Label className="text-base font-semibold">Preview (Highlights with Images)</Label>
                  <div className="flex flex-wrap gap-2 mt-3 p-4 bg-muted/50 rounded-lg">
                    {validHighlights.map((highlight, index) => (
                      <Badge key={index} variant="secondary" className="text-xs">
                        {highlight.text.length > 25 ? highlight.text.substring(0, 25) + '...' : highlight.text}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Only highlights with associated images will be saved ({validHighlights.length} of {highlightsWithImages.length})
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-between items-center pt-6 border-t mt-6">
            <div className="text-sm text-muted-foreground">
              {validHighlights.length} highlights ready to save
            </div>
            <div className="flex space-x-3">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button 
                onClick={handleSave}
                disabled={validHighlights.length === 0}
              >
                <Save className="w-4 h-4 mr-2" />
                Save {validHighlights.length} Highlights
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};