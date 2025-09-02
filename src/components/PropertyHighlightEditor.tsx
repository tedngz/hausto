import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Wand2, Save, X, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Property } from '@/hooks/useProperties';

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
  const [highlights, setHighlights] = useState<string[]>(
    property.vibe_analysis?.generated_content?.highlights || property.highlights || []
  );
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [newHighlight, setNewHighlight] = useState('');
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
        setHighlights(newHighlights);
        toast({
          title: "Highlights Generated",
          description: "AI has generated new property highlights based on your images.",
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
      setHighlights([...highlights, newHighlight.trim()]);
      setNewHighlight('');
    }
  };

  const removeHighlight = (index: number) => {
    setHighlights(highlights.filter((_, i) => i !== index));
  };

  const updateHighlight = (index: number, value: string) => {
    const updated = highlights.map((h, i) => i === index ? value : h);
    setHighlights(updated);
  };

  const handleSave = () => {
    onHighlightsUpdate(highlights.filter(h => h.trim()));
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white">
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Edit Property Highlights</h2>
            <p className="text-gray-600 text-sm">Customize highlights that describe your property</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="p-6 space-y-6">
          {/* AI Regeneration */}
          <div className="flex items-center justify-between p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg border">
            <div>
              <h3 className="font-medium text-gray-900">AI-Generated Highlights</h3>
              <p className="text-sm text-gray-600">Let AI analyze your images and create new highlights</p>
            </div>
            <Button
              onClick={handleRegenerateHighlights}
              disabled={isRegenerating}
              className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700"
            >
              <Wand2 className="w-4 h-4 mr-2" />
              {isRegenerating ? 'Generating...' : 'Regenerate'}
            </Button>
          </div>

          {/* Current Highlights */}
          <div>
            <Label className="text-base font-semibold">Current Highlights</Label>
            <div className="space-y-3 mt-3">
              {highlights.map((highlight, index) => (
                <div key={index} className="flex items-center space-x-3 p-3 border rounded-lg">
                  <Textarea
                    value={highlight}
                    onChange={(e) => updateHighlight(index, e.target.value)}
                    className="flex-1 min-h-[40px] resize-none"
                    placeholder="Enter highlight description..."
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => removeHighlight(index)}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
              
              {highlights.length === 0 && (
                <div className="text-center py-8 text-gray-500">
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
                className="bg-green-500 hover:bg-green-600"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Preview */}
          {highlights.length > 0 && (
            <div>
              <Label className="text-base font-semibold">Preview</Label>
              <div className="flex flex-wrap gap-2 mt-3 p-4 bg-gray-50 rounded-lg">
                {highlights.map((highlight, index) => (
                  <Badge key={index} variant="secondary" className="text-xs">
                    {highlight.length > 30 ? highlight.substring(0, 30) + '...' : highlight}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button 
              onClick={handleSave}
              className="bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600"
            >
              <Save className="w-4 h-4 mr-2" />
              Save Highlights
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};