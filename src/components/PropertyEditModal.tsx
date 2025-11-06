import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { X, Upload, MapPin, Wand2, RefreshCw, Eye, Sparkles, Loader2 } from 'lucide-react';
import { PropertyHighlightEditor } from '@/components/PropertyHighlightEditor';
import { ImageHighlightEditor } from '@/components/ImageHighlightEditor';
import { PropertyPreviewModal } from '@/components/PropertyPreviewModal';
import { PropertyAmenities } from '@/components/PropertyAmenities';
import { useProperties, Property } from '@/hooks/useProperties';
import { useToast } from '@/hooks/use-toast';
import { CurrencySelector } from '@/components/CurrencySelector';
import { useCurrency } from '@/contexts/CurrencyContext';
import { supabase } from '@/integrations/supabase/client';
import { processImageFiles } from '@/utils/imageConverter';
import { propertySchema } from '@/lib/validation';

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
  const [sourceLink, setSourceLink] = useState('');
  const [sourceProviderName, setSourceProviderName] = useState('');
  const [sourceProviderPhone, setSourceProviderPhone] = useState('');
  const [price, setPrice] = useState('');
  const [size, setSize] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedVibes, setSelectedVibes] = useState<string[]>([]);
  const [isHighlightEditorOpen, setIsHighlightEditorOpen] = useState(false);
  const [showHighlightEditor, setShowHighlightEditor] = useState(false);
  const [currentHighlights, setCurrentHighlights] = useState<string[]>([]);
  const [imageHighlights, setImageHighlights] = useState<{text: string, imageIndexes: number[]}[]>([]);
  const [currentVibeAnalysis, setCurrentVibeAnalysis] = useState<any>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isRegeneratingTitle, setIsRegeneratingTitle] = useState(false);
  const [isRegeneratingDescription, setIsRegeneratingDescription] = useState(false);
  const [detectedAmenities, setDetectedAmenities] = useState<string[]>([]);
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);
  const [newAmenity, setNewAmenity] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  const { updateProperty, isUpdating } = useProperties();
  const { toast } = useToast();
  const { currency, convertPrice } = useCurrency();

  const vibeOptions = [
    'Modern', 'Cozy', 'Industrial', 'Bohemian', 'Scandinavian', 'Minimalist', 
    'Contemporary', 'Traditional', 'Rustic', 'Luxury', 'Urban', 'Vintage',
    'Pet Friendly', 'Gym Access', 'Pool', 'Parking', 'Balcony', 'Garden', 
    'Elevator', 'Security', 'WiFi', 'Furnished', 'Air Conditioning', 'Washing Machine',
    'City Center', 'Quiet Neighborhood', 'Near Metro', 'Shopping Nearby', 
    'School District', 'Business District', 'Riverside', 'Mountain View', 'Beach Access',
    'High Ceilings', 'Natural Light', 'Open Plan', 'Walk-in Closet', 
    'En-suite Bathroom', 'Kitchen Island', 'Hardwood Floors', 'Marble Counters', 'Smart Home'
  ];

  const locationSuggestions = [
    '45 Nguyen Hue Street, District 1, Ho Chi Minh City',
    '123 Le Lai Street, District 1, Ho Chi Minh City',
    '78 Dong Khoi Street, District 1, Ho Chi Minh City',
    '234 Saigon Pearl, District 2, Ho Chi Minh City',
    '567 Masteri Thao Dien, District 2, Ho Chi Minh City',
    '89 The Vista, District 2, Ho Chi Minh City',
    '12 Vo Van Tang Street, District 3, Ho Chi Minh City',
    '345 Nam Ky Khoi Nghia Street, District 3, Ho Chi Minh City',
    '678 Phu My Hung, District 7, Ho Chi Minh City',
    '901 Midtown Sakura Park, District 7, Ho Chi Minh City',
    '23 Tran Phu Street, Ba Dinh, Hanoi',
    '456 Kim Ma Street, Ba Dinh, Hanoi',
    '789 Hang Bai Street, Hoan Kiem, Hanoi',
    '147 Trang Tien Street, Hoan Kiem, Hanoi',
    '258 Duy Tan Street, Cau Giay, Hanoi',
    '369 Nguyen Hoang Ton Street, Cau Giay, Hanoi',
    '741 Lang Ha Street, Dong Da, Hanoi',
    '852 Xa Dan Street, Dong Da, Hanoi'
  ];

  useEffect(() => {
    if (property) {
      setTitle(property.title);
      setDescription(property.description || '');
      setLocation(property.location);
      setSourceLink((property as any).property_source_link || '');
      setSourceProviderName((property as any).property_source_provider_name || '');
      setSourceProviderPhone((property as any).property_source_provider_phone || '');
      setPrice(convertPrice(property.price).toString());
      setSize(property.size?.replace('m²', '') || '');
      setSelectedVibes(property.highlights || []);
      setCurrentHighlights(property.vibe_analysis?.generated_content?.highlights || property.highlights || []);
      
      // Extract image highlights
      if (property.vibe_analysis?.image_analyses && Array.isArray(property.vibe_analysis.image_analyses)) {
        const highlightsWithImages = property.vibe_analysis.image_analyses
          .map((imgAnalysis: any, index: number) => {
            if (imgAnalysis.image_highlight) {
              return {
                text: imgAnalysis.image_highlight,
                imageIndexes: [index]
              };
            }
            return null;
          })
          .filter((h: any) => h !== null);
        setImageHighlights(highlightsWithImages);
      }
      
      setCurrentVibeAnalysis(property.vibe_analysis);
      setExistingImages(property.images || []);
      const propertyAmenities = (property as any).amenities || [];
      setDetectedAmenities(propertyAmenities);
      setSelectedAmenities(propertyAmenities);
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
    const allImages = [...existingImages, ...newImagePreviews];
    
    if (allImages.length === 0) {
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
          imageUrls: allImages,
          generateContent: true,
          propertyInfo: {
            location,
            price: parseInt(price),
            size,
            currency
          }
        }
      });

      if (error) throw error;

      const analysis = data?.analysis;

      if (analysis?.generated_content) {
        const generated = analysis.generated_content;
        setTitle(generated.title || `Beautiful ${size}m² Property in ${location.split(',')[0]}`);
        setDescription(generated.description || 'A wonderful space perfect for your next home.');
        
        // Extract per-image highlights
        if (analysis.image_analyses && Array.isArray(analysis.image_analyses)) {
          const highlightsWithImages = analysis.image_analyses
            .map((imgAnalysis: any, index: number) => {
              if (imgAnalysis.image_highlight) {
                return {
                  text: imgAnalysis.image_highlight,
                  imageIndexes: [index]
                };
              }
              return null;
            })
            .filter((h: any) => h !== null);
          setImageHighlights(highlightsWithImages);
        }
        
        setCurrentVibeAnalysis(analysis);
        
        // Extract and set amenities
        if (analysis.amenities && Array.isArray(analysis.amenities)) {
          setDetectedAmenities(analysis.amenities);
          setSelectedAmenities(analysis.amenities);
        }
        
        // Auto-select vibes based on AI analysis
        const aiVibes = [];
        if (analysis.modern >= 5) aiVibes.push('Modern');
        if (analysis.cozy >= 5) aiVibes.push('Cozy');
        if (analysis.luxurious >= 6) aiVibes.push('Luxury');
        if (analysis.urban >= 5) aiVibes.push('Urban');
        if (analysis.minimalist >= 5) aiVibes.push('Minimalist');
        if (analysis.elegant >= 5) aiVibes.push('Contemporary');
        
        const uniqueVibes = [...new Set(aiVibes)];
        setSelectedVibes(uniqueVibes.slice(0, 5));

        toast({
          title: "Content Regenerated!",
          description: "AI has analyzed your property and updated all content.",
        });
      }
    } catch (error) {
      console.error('Error regenerating content:', error);
      toast({
        title: "Generation Failed",
        description: "Failed to regenerate content. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsRegenerating(false);
    }
  };

  const regenerateTitle = async () => {
    const allImages = [...existingImages, ...newImagePreviews];
    if (allImages.length === 0) {
      toast({
        title: "No Images",
        description: "Please add images first.",
        variant: "destructive"
      });
      return;
    }

    setIsRegeneratingTitle(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-vibe', {
        body: {
          imageUrls: allImages,
          generateContent: true,
          propertyInfo: { location, price: parseInt(price), size, currency }
        }
      });

      if (error) throw error;

      if (data?.analysis?.generated_content?.title) {
        setTitle(data.analysis.generated_content.title);
        toast({ title: "Title Updated!", description: "New title generated successfully." });
      }
    } catch (error) {
      console.error('Error regenerating title:', error);
      toast({
        title: "Failed",
        description: "Could not regenerate title.",
        variant: "destructive"
      });
    } finally {
      setIsRegeneratingTitle(false);
    }
  };

  const regenerateDescription = async () => {
    const allImages = [...existingImages, ...newImagePreviews];
    if (allImages.length === 0) {
      toast({
        title: "No Images",
        description: "Please add images first.",
        variant: "destructive"
      });
      return;
    }

    setIsRegeneratingDescription(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-vibe', {
        body: {
          imageUrls: allImages,
          generateContent: true,
          propertyInfo: { location, price: parseInt(price), size, currency }
        }
      });

      if (error) throw error;

      if (data?.analysis?.generated_content?.description) {
        setDescription(data.analysis.generated_content.description);
        toast({ title: "Description Updated!", description: "New description generated successfully." });
      }
    } catch (error) {
      console.error('Error regenerating description:', error);
      toast({
        title: "Failed",
        description: "Could not regenerate description.",
        variant: "destructive"
      });
    } finally {
      setIsRegeneratingDescription(false);
    }
  };

  const handleHighlightsUpdate = (newHighlights: {text: string, imageIndexes: number[]}[], newVibeAnalysis: any) => {
    setImageHighlights(newHighlights);
    setCurrentVibeAnalysis(newVibeAnalysis);
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

    // Validate property data
    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum <= 0) {
      toast({
        title: "Invalid Price",
        description: "Please enter a valid price greater than 0.",
        variant: "destructive"
      });
      return;
    }

    // Optional provider phone validation
    const phoneTrimmed = sourceProviderPhone?.trim();
    if (phoneTrimmed && !/^\+?[1-9]\d{1,14}$/.test(phoneTrimmed)) {
      toast({
        title: "Invalid Provider Phone",
        description: "Use E.164 format, e.g. +1234567890.",
        variant: "destructive"
      });
      return;
    }

    // Zod validation
    try {
      const validationData = {
        title,
        description: description && description.trim() ? description : undefined,
        location,
        price: priceNum,
        size: size ? `${size.trim()}m²` : undefined,
        vibe: selectedVibes[0] || '',
        highlights: imageHighlights.length > 0 ? imageHighlights.map(h => h.text) : selectedVibes,
        images: [],
        property_source_link: sourceLink && sourceLink.trim() ? sourceLink : undefined,
      };

      propertySchema.parse(validationData);
    } catch (error: any) {
      const errorMessage = error.errors?.[0]?.message || "Please check your input and try again.";
      const fieldName = error.errors?.[0]?.path?.[0] || '';

      toast({
        title: "Validation Error",
        description: fieldName ? `${fieldName}: ${errorMessage}` : errorMessage,
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
      highlights: imageHighlights.length > 0 ? imageHighlights.map(h => h.text) : selectedVibes,
      vibeAnalysis: {
        ...currentVibeAnalysis,
        amenities: selectedAmenities
      },
      newImageFiles,
      existingImages,
      amenities: selectedAmenities,
      propertySourceLink: sourceLink,
      propertySourceProviderName: sourceProviderName,
      propertySourceProviderPhone: sourceProviderPhone,
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

          {/* Generate Content Button */}
          <div className="bg-gradient-to-r from-purple-50 to-pink-50 p-4 rounded-lg border border-purple-200">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900 mb-1">AI Content Generation</h3>
                <p className="text-sm text-gray-600">Regenerate all content based on images</p>
              </div>
              <Button
                onClick={regenerateContent}
                disabled={isRegenerating || (existingImages.length === 0 && newImagePreviews.length === 0)}
                className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
              >
                {isRegenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Regenerate All Content
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Basic Info */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label htmlFor="title">Property Title *</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={regenerateTitle}
                disabled={isRegeneratingTitle}
                className="text-purple-600 border-purple-200 hover:bg-purple-50"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${isRegeneratingTitle ? 'animate-spin' : ''}`} />
                {isRegeneratingTitle ? 'Regenerating...' : 'Regenerate'}
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
                  list="location-suggestions-edit"
                />
                <datalist id="location-suggestions-edit">
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

          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="source-link">Property Source Link</Label>
              <Input 
                id="source-link"
                value={sourceLink}
                onChange={(e) => setSourceLink(e.target.value)}
                placeholder="https://..."
              />
            </div>
            <div>
              <Label htmlFor="provider-name">Provider Name</Label>
              <Input 
                id="provider-name"
                value={sourceProviderName}
                onChange={(e) => setSourceProviderName(e.target.value)}
                placeholder="e.g., John Doe"
              />
            </div>
            <div>
              <Label htmlFor="provider-phone">Provider Phone</Label>
              <Input 
                id="provider-phone"
                value={sourceProviderPhone}
                onChange={(e) => setSourceProviderPhone(e.target.value)}
                placeholder="+1234567890"
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
          {(existingImages.length > 0 || newImagePreviews.length > 0) && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <Label className="text-base font-semibold">Image Highlights</Label>
                  <p className="text-sm text-gray-600">AI-generated highlights for each image</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowHighlightEditor(true)}
                  className="text-blue-600 border-blue-200 hover:bg-blue-50"
                >
                  <Wand2 className="w-4 h-4 mr-2" />
                  Edit Image Highlights
                </Button>
              </div>
              
              {imageHighlights.length > 0 ? (
                <div className="space-y-3">
                  {imageHighlights.map((highlight, index) => {
                    const allImages = [...existingImages, ...newImagePreviews];
                    const imageIndex = highlight.imageIndexes[0];
                    
                    return (
                      <div key={index} className="flex items-center gap-3 p-3 bg-gradient-to-r from-orange-50 to-pink-50 rounded-lg border border-orange-100">
                        {allImages[imageIndex] && (
                          <img
                            src={allImages[imageIndex]}
                            alt={`Property feature ${index + 1}`}
                            className="w-16 h-12 object-cover rounded-md flex-shrink-0"
                          />
                        )}
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-900">{highlight.text}</p>
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

          {/* Description */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label htmlFor="description" className="text-base font-semibold">Property Description</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={regenerateDescription}
                disabled={isRegeneratingDescription}
                className="text-purple-600 border-purple-200 hover:bg-purple-50"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${isRegeneratingDescription ? 'animate-spin' : ''}`} />
                {isRegeneratingDescription ? 'Regenerating...' : 'Regenerate'}
              </Button>
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
              {detectedAmenities.map((amenity, index) => {
                const isSelected = selectedAmenities.includes(amenity);
                return (
                  <Badge
                    key={index}
                    variant={isSelected ? "default" : "outline"}
                    className={`cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-gradient-to-r from-blue-500 to-purple-500 text-white'
                        : 'hover:bg-gray-100'
                    }`}
                    onClick={() => {
                      if (isSelected) {
                        setSelectedAmenities(selectedAmenities.filter(a => a !== amenity));
                      } else {
                        setSelectedAmenities([...selectedAmenities, amenity]);
                      }
                    }}
                  >
                    {amenity}
                  </Badge>
                );
              })}
            </div>
            
            <div className="flex gap-2 mt-3">
              <Input
                value={newAmenity}
                onChange={(e) => setNewAmenity(e.target.value)}
                placeholder="Add custom amenity..."
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const trimmed = newAmenity.trim();
                    if (trimmed && !detectedAmenities.includes(trimmed)) {
                      setDetectedAmenities([...detectedAmenities, trimmed]);
                      setSelectedAmenities([...selectedAmenities, trimmed]);
                      setNewAmenity('');
                    }
                  }
                }}
              />
              <Button
                type="button"
                onClick={() => {
                  const trimmed = newAmenity.trim();
                  if (trimmed && !detectedAmenities.includes(trimmed)) {
                    setDetectedAmenities([...detectedAmenities, trimmed]);
                    setSelectedAmenities([...selectedAmenities, trimmed]);
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

          {/* Submit Buttons */}
          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button 
              variant="outline"
              onClick={() => setShowPreview(true)}
              className="border-blue-500 text-blue-600 hover:bg-blue-50"
            >
              <Eye className="w-4 h-4 mr-2" />
              Preview
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

      {/* Property Highlight Editor */}
      {property && (
        <PropertyHighlightEditor
          property={property}
          isOpen={showHighlightEditor}
          onClose={() => setShowHighlightEditor(false)}
          onHighlightsUpdate={(highlights, vibeAnalysis) => {
            // Convert highlights array to image highlights format
            const newImageHighlights = highlights.map((text, index) => ({
              text,
              imageIndexes: [index]
            }));
            setImageHighlights(newImageHighlights);
            setCurrentVibeAnalysis(vibeAnalysis);
            setShowHighlightEditor(false);
          }}
        />
      )}

      {/* Preview Modal */}
      {showPreview && property && (
        <PropertyPreviewModal
          isOpen={showPreview}
          onClose={() => setShowPreview(false)}
          property={{
            ...property,
            title,
            description,
            location,
            price: currency === 'USD' ? parseInt(price) * 24500 : parseInt(price),
            size: size ? `${size}m²` : '',
            highlights: imageHighlights.length > 0 ? imageHighlights.map(h => h.text) : selectedVibes,
            images: [...existingImages, ...newImagePreviews],
            vibe_analysis: currentVibeAnalysis,
            amenities: selectedAmenities,
            property_source_link: sourceLink,
            property_source_provider_name: sourceProviderName,
            property_source_provider_phone: sourceProviderPhone,
          }}
        />
      )}
    </div>
  );
};
