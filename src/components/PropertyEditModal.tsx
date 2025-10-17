import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { X, Upload, MapPin, Wand2, RefreshCw } from 'lucide-react';
import { PropertyHighlightEditor } from '@/components/PropertyHighlightEditor';
import { useProperties, Property } from '@/hooks/useProperties';
import { useToast } from '@/hooks/use-toast';
import { CurrencySelector } from '@/components/CurrencySelector';
import { useCurrency } from '@/contexts/CurrencyContext';
import { supabase } from '@/integrations/supabase/client';
import { processImageFiles } from '@/utils/imageConverter';

interface PropertyEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  property: Property | null;
}

export const PropertyEditModal = ({ isOpen, onClose, property }: PropertyEditModalProps) => {
  const [newImageFiles, setNewImageFiles] = useState<File[]>([]);
  const [newImagePreviews, setNewImagePreviews] = useState<string[]>([]);
  const [existingImages, setExistingImages] = useState<string[]>([]);
  const [location, setLocation] = useState('');
  const [price, setPrice] = useState('');
  const [size, setSize] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedVibes, setSelectedVibes] = useState<string[]>([]);
  const [isHighlightEditorOpen, setIsHighlightEditorOpen] = useState(false);
  const [currentHighlights, setCurrentHighlights] = useState<string[]>([]);
  const [currentVibeAnalysis, setCurrentVibeAnalysis] = useState<any>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [amenities, setAmenities] = useState<string[]>([]);
  const [newAmenity, setNewAmenity] = useState('');

  const { updateProperty, isUpdating } = useProperties();
  const { toast } = useToast();
  const { currency, convertPrice } = useCurrency();

  const vibeOptions = [
    'Modern Minimalist', 'Cozy Traditional', 'Urban Chic', 'Bohemian Eclectic',
    'Industrial Loft', 'Scandinavian Clean', 'Vintage Charm', 'Luxury Executive',
    'Artistic Creative', 'Family Friendly', 'Young Professional', 'Pet Friendly'
  ];

  const predefinedAmenities = [
    'AC', 'Workspace', 'Natural Light', 'Balcony', 'Desk', 'Chair',
    'Large Windows', 'Appliances', 'WiFi', 'Parking', 'Gym', 'Pool',
    'Elevator', 'Security', 'Pet Friendly', 'Furnished', 'Kitchen',
    'Washing Machine', 'Dryer', 'Dishwasher', 'Microwave', 'Refrigerator'
  ];

  const locationSuggestions = [
    'District 1, Ho Chi Minh City',
    'District 2, Ho Chi Minh City', 
    'District 3, Ho Chi Minh City',
    'District 7, Ho Chi Minh City',
    'Ba Dinh, Hanoi',
    'Hoan Kiem, Hanoi',
    'Cau Giay, Hanoi',
    'Dong Da, Hanoi'
  ];

  useEffect(() => {
    if (property) {
      setTitle(property.title);
      setDescription(property.description || '');
      setLocation(property.location);
      setPrice(convertPrice(property.price).toString());
      setSize(property.size?.replace('m²', '') || '');
      setSelectedVibes(property.highlights || []);
      setCurrentHighlights(property.vibe_analysis?.generated_content?.highlights || property.highlights || []);
      setCurrentVibeAnalysis(property.vibe_analysis);
      setExistingImages(property.images || []);
      setAmenities((property as any).amenities || []);
    }
  }, [property, convertPrice]);

  const handleNewImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      const newFiles = Array.from(files);
      
      try {
        // Convert AVIF files to PNG for OpenAI compatibility
        const processedFiles = await processImageFiles(newFiles);
        setNewImageFiles(prev => [...prev, ...processedFiles]);
        
        processedFiles.forEach(file => {
          const reader = new FileReader();
          reader.onload = (e) => {
            if (e.target?.result) {
              setNewImagePreviews(prev => [...prev, e.target!.result as string]);
            }
          };
          reader.readAsDataURL(file);
        });
      } catch (error) {
        console.error('Error processing image files:', error);
        toast({
          title: "Image Processing Error",
          description: "Failed to process AVIF images. Please try again.",
          variant: "destructive"
        });
      }
    }
  };

  const removeExistingImage = (index: number) => {
    setExistingImages(prev => prev.filter((_, i) => i !== index));
  };

  const removeNewImage = (index: number) => {
    setNewImageFiles(prev => prev.filter((_, i) => i !== index));
    setNewImagePreviews(prev => prev.filter((_, i) => i !== index));
  };

  const regenerateContent = async () => {
    if (!property?.images || property.images.length === 0) {
      toast({
        title: "No Images",
        description: "Please add images to regenerate content.",
        variant: "destructive"
      });
      return;
    }

    setIsRegenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-vibe', {
        body: {
          imageUrls: property.images,
          generateContent: true,
          propertyInfo: {
            location: location,
            size: size ? `${size}m²` : undefined,
            price: price
          }
        }
      });

      if (error) throw error;

      if (data) {
        // Update title and description if generated
        if (data.generated_content?.title) {
          setTitle(data.generated_content.title);
        }
        if (data.generated_content?.description) {
          setDescription(data.generated_content.description);
        }

        // Update highlights if generated
        if (data.generated_content?.highlights) {
          setCurrentHighlights(data.generated_content.highlights);
        }

        // Update vibe analysis
        setCurrentVibeAnalysis(data);

        toast({
          title: "Content Regenerated",
          description: "Property title, description, and highlights have been updated with AI-generated content.",
        });
      }
    } catch (error) {
      console.error('Error regenerating content:', error);
      toast({
        title: "Error",
        description: "Failed to regenerate content. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleSubmit = () => {
    if (!property || !title || !location || !price) {
      toast({
        title: "Missing Information",
        description: "Please fill in all required fields.",
        variant: "destructive"
      });
      return;
    }

    // Convert price to VND if in USD
    const priceInVND = currency === 'USD' ? parseInt(price) * 24500 : parseInt(price);

    updateProperty({
      id: property.id,
      title,
      description,
      location,
      price: priceInVND,
      size: size ? `${size}m²` : undefined,
      vibe: selectedVibes[0] || null,
      highlights: currentHighlights.length > 0 ? currentHighlights : selectedVibes,
      vibeAnalysis: currentVibeAnalysis,
      newImageFiles,
      existingImages,
      amenities,
    });

    // Reset form
    setNewImageFiles([]);
    setNewImagePreviews([]);
    onClose();
  };

  if (!isOpen || !property) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-white">
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Edit Property</h2>
            <p className="text-gray-600">Update your property listing</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="p-6 space-y-6">
          {/* Existing Images */}
          <div>
            <Label className="text-base font-semibold">Current Images</Label>
            {existingImages.length > 0 ? (
              <div className="grid grid-cols-4 gap-2 mt-2">
                {existingImages.map((img, index) => (
                  <div key={index} className="relative group">
                    <img src={img} alt={`Property ${index + 1}`} className="w-full h-20 object-cover rounded" />
                    <button
                      onClick={() => removeExistingImage(index)}
                      className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 mt-2">No existing images</p>
            )}
          </div>

          {/* Add New Images */}
          <div>
            <Label htmlFor="new-images" className="text-base font-semibold">Add New Images</Label>
            <div className="mt-2">
              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Upload className="w-8 h-8 text-gray-400 mb-2" />
                  <p className="text-sm text-gray-600">Click to add more images</p>
                </div>
                <input 
                  id="new-images" 
                  type="file" 
                  multiple 
                  accept="image/*" 
                  className="hidden" 
                  onChange={handleNewImageUpload}
                />
              </label>
              {newImagePreviews.length > 0 && (
                <div className="grid grid-cols-4 gap-2 mt-4">
                  {newImagePreviews.map((img, index) => (
                    <div key={index} className="relative group">
                      <img src={img} alt={`New ${index + 1}`} className="w-full h-20 object-cover rounded" />
                      <button
                        onClick={() => removeNewImage(index)}
                        className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Basic Info */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label htmlFor="title">Property Title *</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={regenerateContent}
                disabled={isRegenerating || !property?.images?.length}
                className="text-purple-600 border-purple-200 hover:bg-purple-50"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${isRegenerating ? 'animate-spin' : ''}`} />
                {isRegenerating ? 'Regenerating...' : 'Regenerate Content'}
              </Button>
            </div>
            <Input 
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Stunning Downtown Loft"
            />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="location">Location *</Label>
              <div className="relative">
                <MapPin className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                <Input 
                  id="location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Select or type location"
                  className="pl-10"
                  list="location-suggestions"
                />
                <datalist id="location-suggestions">
                  {locationSuggestions.map((suggestion, index) => (
                    <option key={index} value={suggestion} />
                  ))}
                </datalist>
              </div>
            </div>
            <div>
              <Label htmlFor="size">Size (m²)</Label>
              <Input 
                id="size"
                type="number"
                value={size}
                onChange={(e) => setSize(e.target.value)}
                placeholder="e.g., 75"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="price">Monthly Rent *</Label>
            <div className="flex space-x-2">
              <Input 
                id="price"
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder={currency === 'VND' ? "e.g., 15000000" : "e.g., 600"}
                className="flex-1"
              />
              <CurrencySelector />
            </div>
          </div>

          {/* Image Highlights */}
          {property.images && property.images.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <Label className="text-base font-semibold">Image Highlights</Label>
                  <p className="text-sm text-gray-600">AI-generated highlights for each image</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsHighlightEditorOpen(true)}
                  className="text-blue-600 border-blue-200 hover:bg-blue-50"
                >
                  <Wand2 className="w-4 h-4 mr-2" />
                  Edit Image Highlights
                </Button>
              </div>
              
              {/* Display image highlights */}
              {currentVibeAnalysis?.image_analyses && currentVibeAnalysis.image_analyses.length > 0 ? (
                <div className="space-y-3">
                  {property.images.map((image, index) => {
                    const analysisForImage = currentVibeAnalysis.image_analyses.find((a: any) => a.image_index === index);
                    const highlight = analysisForImage?.image_highlight;
                    
                    return (
                      <div key={index} className="flex items-center gap-3 p-3 bg-gradient-to-r from-orange-50 to-pink-50 rounded-lg border border-orange-100">
                        <img
                          src={image}
                          alt={`Property feature ${index + 1}`}
                          className="w-16 h-12 object-cover rounded-md flex-shrink-0"
                        />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-900">
                            {highlight || "No highlight generated for this image"}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-4 border-2 border-dashed border-gray-300 rounded-lg text-center">
                  <p className="text-gray-500">No image highlights yet. Click "Edit Image Highlights" to generate them.</p>
                </div>
              )}
            </div>
          )}

          {/* Property Vibes */}
          <div>
            <Label className="text-base font-semibold">Property Vibes & Tags</Label>
            <p className="text-sm text-gray-600 mb-3">Select vibes and tags that best describe your property</p>
            
            {/* Show AI-detected vibes first if available */}
            {currentVibeAnalysis && (
              <div className="mb-4">
                <p className="text-sm font-medium text-gray-700 mb-2">AI-Detected Vibes:</p>
                <div className="flex flex-wrap gap-2">
                {Object.entries(currentVibeAnalysis)
                    .filter(([key, value]) => 
                      ['modern', 'cozy', 'luxurious', 'minimalist', 'colorful', 'spacious', 'natural_light', 'urban', 'rustic', 'elegant'].includes(key) && 
                      typeof value === 'number' && (value as number) >= 7
                    )
                    .map(([vibe, score]) => (
                      <Badge
                        key={vibe}
                        variant="secondary"
                        className="bg-gradient-to-r from-blue-100 to-blue-200 text-blue-800 border-blue-300 cursor-pointer"
                        onClick={() => {
                          const vibeLabel = vibe.charAt(0).toUpperCase() + vibe.slice(1).replace('_', ' ');
                          const matchingVibe = vibeOptions.find(v => v.toLowerCase().includes(vibeLabel.toLowerCase()));
                          if (matchingVibe && !selectedVibes.includes(matchingVibe)) {
                            setSelectedVibes(prev => [...prev, matchingVibe]);
                          }
                        }}
                      >
                        {vibe.charAt(0).toUpperCase() + vibe.slice(1).replace('_', ' ')} ({score as number}/10)
                      </Badge>
                    ))}
                </div>
              </div>
            )}
            
            {/* Manual vibe selection */}
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Manual Selection:</p>
              <div className="flex flex-wrap gap-2">
                {vibeOptions.map((vibe) => (
                  <Badge
                    key={vibe}
                    variant={selectedVibes.includes(vibe) ? "default" : "outline"}
                    className={`cursor-pointer transition-colors ${
                      selectedVibes.includes(vibe) 
                        ? 'bg-gradient-to-r from-orange-500 to-pink-500 text-white' 
                        : 'hover:bg-gray-100'
                    }`}
                    onClick={() => {
                      setSelectedVibes(prev => 
                        prev.includes(vibe) 
                          ? prev.filter(v => v !== vibe)
                          : [...prev, vibe]
                      );
                    }}
                  >
                    {vibe}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          {/* Description */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label htmlFor="description" className="text-base font-semibold">Property Description</Label>
              <p className="text-sm text-gray-500">Use the "Regenerate Content" button above to update</p>
            </div>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what makes this property special..."
              rows={6}
              className="resize-none"
            />
          </div>

          {/* Amenities */}
          <div>
            <Label className="text-base font-semibold">Amenities</Label>
            <p className="text-sm text-gray-600 mb-3">Click to select/deselect amenities</p>
            
            <div className="flex flex-wrap gap-2 mb-4">
              {predefinedAmenities.map((amenity) => {
                const isSelected = amenities.includes(amenity);
                return (
                  <Badge
                    key={amenity}
                    variant={isSelected ? "default" : "outline"}
                    className={`cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                        : 'hover:bg-muted'
                    }`}
                    onClick={() => {
                      if (isSelected) {
                        setAmenities(amenities.filter(a => a !== amenity));
                      } else {
                        setAmenities([...amenities, amenity]);
                      }
                    }}
                  >
                    {amenity}
                  </Badge>
                );
              })}
              
              {/* Show custom amenities that aren't in predefined list */}
              {amenities.filter(a => !predefinedAmenities.includes(a)).map((amenity, index) => (
                <Badge
                  key={`custom-${index}`}
                  variant="default"
                  className="cursor-pointer bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={() => setAmenities(amenities.filter(a => a !== amenity))}
                >
                  {amenity}
                </Badge>
              ))}
            </div>
            
            <div className="flex gap-2 mt-3">
              <Input
                value={newAmenity}
                onChange={(e) => setNewAmenity(e.target.value)}
                placeholder="Add custom amenity..."
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (newAmenity.trim() && !amenities.includes(newAmenity.trim())) {
                      setAmenities([...amenities, newAmenity.trim()]);
                      setNewAmenity('');
                    }
                  }
                }}
              />
              <Button
                type="button"
                onClick={() => {
                  if (newAmenity.trim() && !amenities.includes(newAmenity.trim())) {
                    setAmenities([...amenities, newAmenity.trim()]);
                    setNewAmenity('');
                  }
                }}
                variant="outline"
                disabled={!newAmenity.trim()}
              >
                Add
              </Button>
            </div>
          </div>

          {/* Submit Button */}
          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button 
              onClick={handleSubmit}
              disabled={isUpdating || !title || !location || !price}
              className="bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600"
            >
              {isUpdating ? 'Updating...' : 'Update Property'}
            </Button>
          </div>
        </div>
      </Card>

      {property && (
        <PropertyHighlightEditor
          property={property}
          isOpen={isHighlightEditorOpen}
          onClose={() => setIsHighlightEditorOpen(false)}
          onHighlightsUpdate={(highlights, vibeAnalysis) => {
            setCurrentHighlights(highlights);
            setCurrentVibeAnalysis(vibeAnalysis);
            setIsHighlightEditorOpen(false);
          }}
        />
      )}
    </div>
  );
};
