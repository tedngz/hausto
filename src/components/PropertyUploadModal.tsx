import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { X, Upload, Sparkles, MapPin, Loader2, Eye, Wand2 } from 'lucide-react';
import { useProperties } from '@/hooks/useProperties';
import { useToast } from '@/hooks/use-toast';
import { CurrencySelector } from '@/components/CurrencySelector';
import { useCurrency } from '@/contexts/CurrencyContext';
import { supabase } from '@/integrations/supabase/client';
import { PropertyPreviewModal } from '@/components/PropertyPreviewModal';
import { MapLocationPicker } from '@/components/MapLocationPicker';
import { PropertyHighlightEditor } from '@/components/PropertyHighlightEditor';
import { ImageHighlightEditor } from '@/components/ImageHighlightEditor';
import { processImageFiles } from '@/utils/imageConverter';
import { PropertyAmenities } from '@/components/PropertyAmenities';
import { propertySchema } from '@/lib/validation';
interface PropertyUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PropertyUploadModal = ({ isOpen, onClose }: PropertyUploadModalProps) => {
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [location, setLocation] = useState('');
  const [sourceLink, setSourceLink] = useState('');
  const [sourceProviderName, setSourceProviderName] = useState('');
  const [sourceProviderPhone, setSourceProviderPhone] = useState('');
  const [price, setPrice] = useState('');
  const [size, setSize] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedStyles, setSelectedStyles] = useState<string[]>([]);
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [selectedActivities, setSelectedActivities] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRegeneratingTitle, setIsRegeneratingTitle] = useState(false);
  const [isRegeneratingDescription, setIsRegeneratingDescription] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showHighlightEditor, setShowHighlightEditor] = useState(false);
  const [imageHighlights, setImageHighlights] = useState<{text: string, imageIndexes: number[]}[]>([]);
  const [vibeAnalysis, setVibeAnalysis] = useState<any>(null);
  const [locationSuggestionsVisible, setLocationSuggestionsVisible] = useState(false);
  const [detectedAmenities, setDetectedAmenities] = useState<string[]>([]);
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);
  const [newAmenity, setNewAmenity] = useState('');
  const [pinLatitude, setPinLatitude] = useState<number | null>(null);
  const [pinLongitude, setPinLongitude] = useState<number | null>(null);

  const { createProperty, isCreating } = useProperties();
  const { toast } = useToast();
  const { currency, convertPrice } = useCurrency();

  const styleOptions = ['Modern', 'Cozy', 'Industrial', 'Bohemian', 'Scandinavian', 'Minimalist', 
    'Contemporary', 'Traditional', 'Rustic', 'Luxury', 'Urban', 'Vintage'];
  
  const colorOptions = ['Neutral', 'Warm', 'Cool', 'Bright', 'Dark', 'Colorful', 'Natural', 'White', 'Earth', 'Bold'];
  
  const activityOptions = ['Working', 'Reading', 'Relaxing', 'Entertaining', 'Cooking', 'Exercising'];

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

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      const newFiles = Array.from(files);
      
      // Limit to 10 images max for better performance
      const remainingSlots = 10 - imageFiles.length;
      const filesToAdd = newFiles.slice(0, remainingSlots);
      
      if (newFiles.length > remainingSlots) {
        toast({
          title: "Image Limit",
          description: `Only ${remainingSlots} more images can be added. Maximum 10 images allowed.`,
          variant: "destructive"
        });
      }
      
      try {
        // Convert AVIF files to PNG for OpenAI compatibility
        const processedFiles = await processImageFiles(filesToAdd);
        setImageFiles(prev => [...prev, ...processedFiles]);
        
        // Process previews sequentially to avoid memory issues
        for (const file of processedFiles) {
          try {
            const reader = new FileReader();
            const result = await new Promise<string>((resolve, reject) => {
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(file);
            });
            
            setImagePreviews(prev => [...prev, result]);
          } catch (error) {
            console.error('Error reading file:', error);
            toast({
              title: "File Error",
              description: "Failed to process one or more images.",
              variant: "destructive"
            });
          }
        }
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

  const generateContent = async () => {
    if (!location || !price || !size || imageFiles.length === 0) {
      toast({
        title: "Missing Information",
        description: "Please add images, location, price, and size before generating content.",
        variant: "destructive"
      });
      return;
    }

    setIsGenerating(true);
    
    try {
      // Convert files to base64 URLs for immediate AI analysis
      const imageUrls: string[] = [];
      
      for (const file of imageFiles) {
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve) => {
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
        
        const base64Url = await base64Promise;
        imageUrls.push(base64Url);
      }

      // Call our analyze-vibe function with content generation using Supabase client
      const { data, error } = await supabase.functions.invoke('analyze-vibe', {
        body: {
          imageUrls: imageUrls,
          generateContent: true,
          propertyInfo: {
            location,
            price: parseInt(price),
            size,
            currency
          }
        }
      });

      if (error) {
        throw new Error(error.message || 'Failed to generate content');
      }

      const analysis = data?.analysis;

      if (analysis?.generated_content) {
        const generated = analysis.generated_content;
        setTitle(generated.title || `Beautiful ${size}m² Property in ${location.split(',')[0]}`);
        setDescription(generated.description || 'A wonderful space perfect for your next home.');
        
        // Extract per-image highlights from image_analyses
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
        
        // Store detailed vibe analysis for preview
        setVibeAnalysis(analysis);
        
        // Extract and set amenities from AI analysis
        if (analysis.amenities && Array.isArray(analysis.amenities)) {
          setDetectedAmenities(analysis.amenities);
          setSelectedAmenities(analysis.amenities); // All detected amenities are selected by default
        }
        
        // Auto-select styles, colors, and activities based on AI analysis
        const aiStyles = [];
        const aiColors = [];
        const aiActivities = [];
        
        // Extract styles from AI analysis
        if (analysis.modern >= 5) aiStyles.push('Modern');
        if (analysis.cozy >= 5) aiStyles.push('Cozy');
        if (analysis.luxurious >= 6) aiStyles.push('Luxury');
        if (analysis.urban >= 5) aiStyles.push('Urban');
        if (analysis.minimalist >= 5) aiStyles.push('Minimalist');
        if (analysis.elegant >= 5) aiStyles.push('Contemporary');
        if (analysis.rustic >= 4) aiStyles.push('Rustic');
        if (analysis.colorful >= 5) aiStyles.push('Bohemian');
        if (analysis.industrial >= 4) aiStyles.push('Industrial');
        if (analysis.scandinavian >= 5) aiStyles.push('Scandinavian');
        if (analysis.traditional >= 5) aiStyles.push('Traditional');
        if (analysis.vintage >= 5) aiStyles.push('Vintage');
        
        // Extract colors from AI analysis
        if (analysis.neutral >= 5) aiColors.push('Neutral');
        if (analysis.warm >= 5) aiColors.push('Warm');
        if (analysis.cool >= 5) aiColors.push('Cool');
        if (analysis.bright >= 5 || analysis.natural_light >= 7) aiColors.push('Bright');
        if (analysis.dark >= 5) aiColors.push('Dark');
        if (analysis.colorful >= 6) aiColors.push('Colorful');
        if (analysis.natural_light >= 6) aiColors.push('Natural');
        if (analysis.minimalist >= 6) aiColors.push('White');
        if (analysis.rustic >= 5 || analysis.cozy >= 5) aiColors.push('Earth');
        if (analysis.colorful >= 7 || analysis.modern >= 6) aiColors.push('Bold');
        
        // Extract activities from AI analysis and property characteristics
        if (analysis.modern >= 5 || analysis.spacious >= 6) aiActivities.push('Working');
        if (analysis.cozy >= 6 || analysis.natural_light >= 6) aiActivities.push('Reading');
        if (analysis.cozy >= 5 || analysis.elegant >= 5) aiActivities.push('Relaxing');
        if (analysis.spacious >= 6 || analysis.modern >= 6) aiActivities.push('Entertaining');
        if (analysis.kitchen_quality >= 5) aiActivities.push('Cooking');
        if (analysis.spacious >= 5) aiActivities.push('Exercising');
        
        // Remove duplicates and limit selections
        const uniqueStyles = [...new Set(aiStyles)].slice(0, 3);
        const uniqueColors = [...new Set(aiColors)].slice(0, 3);
        const uniqueActivities = [...new Set(aiActivities)].slice(0, 3);
        
        // Fallbacks if AI didn't detect enough
        if (uniqueStyles.length === 0) uniqueStyles.push('Modern');
        if (uniqueColors.length === 0) uniqueColors.push('Neutral');
        if (uniqueActivities.length === 0) uniqueActivities.push('Relaxing');
        
        setSelectedStyles(uniqueStyles);
        setSelectedColors(uniqueColors);
        setSelectedActivities(uniqueActivities);
      } else {
        // Fallback content if AI generation fails
        const locationShort = location.split(',')[0];
        const priceFormatted = currency === 'VND' ? `${(parseInt(price) / 1000000).toFixed(1)}M VND` : `$${Math.round(parseInt(price) / 24500)}`;
        
        setTitle(`Stunning ${size}m² Apartment in ${locationShort} - ${priceFormatted}/month`);
        setDescription(`Welcome to this exceptional ${size}m² property located in the heart of ${location}. This beautifully designed space offers the perfect blend of comfort and modern living.`);
        setSelectedStyles(['Modern']);
        setSelectedColors(['Neutral']);
        setSelectedActivities(['Relaxing']);
      }
      
      setHasGenerated(true);
      
      toast({
        title: "Content Generated!",
        description: "AI has analyzed your property images and created unique content based on the visual features detected.",
      });
      
    } catch (error) {
      console.error('Error generating content:', error);
      toast({
        title: "Generation Failed",
        description: "Using fallback content generation. Check your internet connection and try again.",
        variant: "destructive"
      });
      
      // Fallback generation
      const locationShort = location.split(',')[0];
      const priceFormatted = currency === 'VND' ? `${(parseInt(price) / 1000000).toFixed(1)}M VND` : `$${Math.round(parseInt(price) / 24500)}`;
      
      setTitle(`Beautiful ${size}m² Property in ${locationShort}`);
      setDescription(`Discover this amazing ${size}m² property in ${location}. A perfect space for modern living.`);
      setSelectedStyles(['Modern']);
      setSelectedColors(['Neutral']);
      setSelectedActivities(['Relaxing']);
      setImageHighlights([{ text: 'Natural Light', imageIndexes: [0] }, { text: 'Modern Design', imageIndexes: [0] }]);
      setHasGenerated(true);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSubmit = () => {
    if (!title || !location || !price || imageFiles.length === 0 || !hasGenerated) {
      toast({
        title: "Missing Information",
        description: hasGenerated ? "Please fill in all required fields." : "Please generate content first before submitting.",
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

    if (!size || isNaN(parseFloat(size))) {
      toast({
        title: "Invalid Size",
        description: "Please enter a valid size in m².",
        variant: "destructive"
      });
      return;
    }

    // Optional provider phone validation (E.164)
    const phoneTrimmed = sourceProviderPhone?.trim();
    if (phoneTrimmed && !/^\+?[1-9]\d{1,14}$/.test(phoneTrimmed)) {
      toast({
        title: "Invalid Provider Phone",
        description: "Use E.164 format, e.g. +1234567890.",
        variant: "destructive"
      });
      return;
    }

    try {
      // Prepare data for validation using Zod
      const validationData = {
        title,
        description: description && description.trim() ? description : undefined,
        location,
        price: priceNum,
        size: `${size.trim()}m²`,
        vibe: selectedStyles[0] || '',
        highlights: [...selectedStyles, ...selectedColors, ...selectedActivities],
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

    // Merge edited per-image highlights into vibe_analysis.image_analyses before creating
    const existingAnalyses = Array.isArray(vibeAnalysis?.image_analyses)
      ? vibeAnalysis.image_analyses
      : [];
    const analysesByIndex = new Map<number, any>(
      existingAnalyses.map((a: any) => [Number(a.image_index) || 0, a])
    );
    imageHighlights.forEach((h) => {
      const idx = (h.imageIndexes && h.imageIndexes[0] !== undefined) ? h.imageIndexes[0] : 0;
      const prev = analysesByIndex.get(idx) || { image_index: idx };
      analysesByIndex.set(idx, { ...prev, image_index: idx, image_highlight: h.text });
    });
    const mergedImageAnalyses = Array.from(analysesByIndex.values());

    createProperty({
      title,
      description,
      location,
      price: priceInVND,
      size: `${size}m²`,
      vibe: selectedStyles[0] || null,
      highlights: [...selectedStyles, ...selectedColors, ...selectedActivities],
      imageFiles,
      vibeAnalysis: {
        ...(vibeAnalysis || {}),
        image_analyses: mergedImageAnalyses,
        styles: selectedStyles,
        colors: selectedColors,
        activities: selectedActivities,
        amenities: selectedAmenities
      },
      propertySourceLink: sourceLink,
      propertySourceProviderName: sourceProviderName,
      propertySourceProviderPhone: sourceProviderPhone,
      latitude: pinLatitude,
      longitude: pinLongitude,
    });

    // Reset form
    setTitle('');
    setLocation('');
    setSourceLink('');
    setSourceProviderName('');
    setSourceProviderPhone('');
    setPrice('');
    setSize('');
    setDescription('');
    setSelectedStyles([]);
    setSelectedColors([]);
    setSelectedActivities([]);
    setImageFiles([]);
    setImagePreviews([]);
    setImageHighlights([]);
    setVibeAnalysis(null);
    setDetectedAmenities([]);
    setSelectedAmenities([]);
    setNewAmenity('');
    setPinLatitude(null);
    setPinLongitude(null);
    setHasGenerated(false);
    setShowHighlightEditor(false);
    onClose();
  };

  const regenerateTitle = async () => {
    if (!vibeAnalysis || imageFiles.length === 0) return;
    
    setIsRegeneratingTitle(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-vibe', {
        body: {
          imageUrls: imagePreviews,
          generateContent: true,
          propertyInfo: { location, price: parseInt(price), size, currency },
          regenerateType: 'title'
        }
      });

      if (error) throw error;
      if (data?.analysis?.generated_content?.title) {
        setTitle(data.analysis.generated_content.title);
        toast({
          title: "Title Regenerated",
          description: "AI has generated a new title for your property."
        });
      }
    } catch (error) {
      console.error('Error regenerating title:', error);
      toast({
        title: "Regeneration Failed",
        description: "Could not regenerate title. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsRegeneratingTitle(false);
    }
  };

  const regenerateDescription = async () => {
    if (!vibeAnalysis || imageFiles.length === 0) return;
    
    setIsRegeneratingDescription(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-vibe', {
        body: {
          imageUrls: imagePreviews,
          generateContent: true,
          propertyInfo: { location, price: parseInt(price), size, currency },
          regenerateType: 'description'
        }
      });

      if (error) throw error;
      if (data?.analysis?.generated_content?.description) {
        setDescription(data.analysis.generated_content.description);
        toast({
          title: "Description Regenerated", 
          description: "AI has generated a new description for your property."
        });
      }
    } catch (error) {
      console.error('Error regenerating description:', error);
      toast({
        title: "Regeneration Failed",
        description: "Could not regenerate description. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsRegeneratingDescription(false);
    }
  };

  const removeImage = (index: number) => {
    setImageFiles(prev => prev.filter((_, i) => i !== index));
    setImagePreviews(prev => prev.filter((_, i) => i !== index));
  };

  const handleHighlightsUpdate = (highlights: string[], updatedVibeAnalysis: any) => {
    setImageHighlights(highlights.map((h, i) => ({ text: h, imageIndexes: [i] })));
    setVibeAnalysis(updatedVibeAnalysis);
    setShowHighlightEditor(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-white">
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Upload New Property</h2>
            <p className="text-gray-600">Upload images and basic details, then let AI create the perfect listing</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="p-6 space-y-6">
          {/* Step 1: Images */}
          <div>
            <Label htmlFor="images" className="text-base font-semibold">Property Images *</Label>
            <div className="mt-2">
              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Upload className="w-8 h-8 text-gray-400 mb-2" />
                  <p className="text-sm text-gray-600">Click to upload property images</p>
                </div>
                <input 
                  id="images" 
                  type="file" 
                  multiple 
                  accept="image/*" 
                  className="hidden" 
                  onChange={handleImageUpload}
                />
              </label>
              {imagePreviews.length > 0 && (
                <div className="grid grid-cols-4 gap-2 mt-4">
                  {imagePreviews.map((img, index) => (
                    <div key={index} className="relative group">
                      <img src={img} alt={`Property ${index + 1}`} className="w-full h-20 object-cover rounded" />
                      <button
                        onClick={() => removeImage(index)}
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

          {/* Step 2: Basic Details */}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="location">Location *</Label>
              <div className="relative">
                <MapPin className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                <Input 
                  id="location"
                  value={location}
                  onChange={(e) => {
                    setLocation(e.target.value);
                    setLocationSuggestionsVisible(e.target.value.length > 0);
                  }}
                  onFocus={() => setLocationSuggestionsVisible(true)}
                  onBlur={() => setTimeout(() => setLocationSuggestionsVisible(false), 200)}
                  placeholder="Start typing address..."
                  className="pl-10"
                />
                {locationSuggestionsVisible && location && (
                  <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-md mt-1 max-h-48 overflow-y-auto shadow-lg">
                    {locationSuggestions
                      .filter(suggestion => 
                        suggestion.toLowerCase().includes(location.toLowerCase())
                      )
                      .slice(0, 8)
                      .map((suggestion, index) => (
                        <div
                          key={index}
                          className="px-3 py-2 cursor-pointer hover:bg-gray-100 text-sm"
                          onClick={() => {
                            setLocation(suggestion);
                            setLocationSuggestionsVisible(false);
                          }}
                        >
                          {suggestion}
                        </div>
                      ))
                    }
                  </div>
                )}
              </div>
            </div>
            <div className="md:col-span-2">
              <MapLocationPicker
                latitude={pinLatitude}
                longitude={pinLongitude}
                onLocationChange={(lat, lng) => { setPinLatitude(lat); setPinLongitude(lng); }}
              />
            </div>
            <div>
              <Label htmlFor="size">Size (m²) *</Label>
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
            <Label htmlFor="sourceLink">Property Source Link (Optional)</Label>
            <Input 
              id="sourceLink"
              type="url"
              value={sourceLink}
              onChange={(e) => setSourceLink(e.target.value)}
              placeholder="https://example.com/property-listing (optional)"
            />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="sourceProviderName">Source Provider Name (Optional)</Label>
              <Input 
                id="sourceProviderName"
                value={sourceProviderName}
                onChange={(e) => setSourceProviderName(e.target.value)}
                placeholder="e.g., ABC Real Estate"
              />
            </div>
            <div>
              <Label htmlFor="sourceProviderPhone">Source Provider Phone (Optional)</Label>
              <Input 
                id="sourceProviderPhone"
                value={sourceProviderPhone}
                onChange={(e) => setSourceProviderPhone(e.target.value)}
                placeholder="e.g., +84123456789"
              />
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
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
            <div className="flex items-end">
              <Button
                onClick={generateContent}
                disabled={isGenerating || !location || !price || !size || imageFiles.length === 0}
                className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Generate Content with AI
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Step 3: Generated Content (only show after generation) */}
          {hasGenerated && (
            <>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label htmlFor="title" className="text-base font-semibold">Generated Title *</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={regenerateTitle}
                    disabled={isRegeneratingTitle}
                    className="text-purple-600 hover:text-purple-700"
                  >
                    {isRegeneratingTitle ? (
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    ) : (
                      <Wand2 className="w-3 h-3 mr-1" />
                    )}
                    Regenerate
                  </Button>
                </div>
                <Input 
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="AI will generate this"
                  className="mt-2"
                />
              </div>

              <div className="space-y-4">
                <div>
                  <Label className="text-base font-semibold">AI Selected Style</Label>
                  <p className="text-sm text-gray-600 mb-3">Select up to 3 styles that best describe this property</p>
                  <div className="flex flex-wrap gap-2">
                    {styleOptions.map((style) => (
                      <Badge
                        key={style}
                        variant={selectedStyles.includes(style) ? "default" : "outline"}
                        className={`cursor-pointer transition-colors ${
                          selectedStyles.includes(style) 
                            ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white' 
                            : 'hover:bg-gray-100'
                        }`}
                        onClick={() => {
                          setSelectedStyles(prev => 
                            prev.includes(style) 
                              ? prev.filter(v => v !== style)
                              : prev.length < 3 ? [...prev, style] : prev
                          );
                        }}
                      >
                        {style}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div>
                  <Label className="text-base font-semibold">AI Selected Color</Label>
                  <p className="text-sm text-gray-600 mb-3">Select up to 3 color schemes</p>
                  <div className="flex flex-wrap gap-2">
                    {colorOptions.map((color) => (
                      <Badge
                        key={color}
                        variant={selectedColors.includes(color) ? "default" : "outline"}
                        className={`cursor-pointer transition-colors ${
                          selectedColors.includes(color) 
                            ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white' 
                            : 'hover:bg-gray-100'
                        }`}
                        onClick={() => {
                          setSelectedColors(prev => 
                            prev.includes(color) 
                              ? prev.filter(v => v !== color)
                              : prev.length < 3 ? [...prev, color] : prev
                          );
                        }}
                      >
                        {color}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div>
                  <Label className="text-base font-semibold">AI Selected Activity</Label>
                  <p className="text-sm text-gray-600 mb-3">Select up to 3 activities suited for this space</p>
                  <div className="flex flex-wrap gap-2">
                    {activityOptions.map((activity) => (
                      <Badge
                        key={activity}
                        variant={selectedActivities.includes(activity) ? "default" : "outline"}
                        className={`cursor-pointer transition-colors ${
                          selectedActivities.includes(activity) 
                            ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white' 
                            : 'hover:bg-gray-100'
                        }`}
                        onClick={() => {
                          setSelectedActivities(prev => 
                            prev.includes(activity) 
                              ? prev.filter(v => v !== activity)
                              : prev.length < 3 ? [...prev, activity] : prev
                          );
                        }}
                      >
                        {activity}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-base font-semibold">Amenities</Label>
                <p className="text-sm text-gray-600 mb-3">Click to select/deselect amenities</p>
                
                <div className="flex flex-wrap gap-2 mb-4">
                  {/* Show all detected amenities */}
                  {detectedAmenities.map((amenity, index) => {
                    const isSelected = selectedAmenities.includes(amenity);
                    return (
                      <Badge
                        key={index}
                        variant={isSelected ? "default" : "outline"}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80'
                        }`}
                        onClick={() => {
                          if (isSelected) {
                            setSelectedAmenities(prev => prev.filter(a => a !== amenity));
                          } else {
                            setSelectedAmenities(prev => [...prev, amenity]);
                          }
                        }}
                      >
                        {amenity}
                      </Badge>
                    );
                  })}
                </div>
                
                <div className="flex gap-2">
                  <Input
                    value={newAmenity}
                    onChange={(e) => setNewAmenity(e.target.value)}
                    placeholder="Add custom amenity..."
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && newAmenity.trim()) {
                        e.preventDefault();
                        const trimmed = newAmenity.trim();
                        if (!detectedAmenities.includes(trimmed)) {
                          setDetectedAmenities(prev => [...prev, trimmed]);
                          setSelectedAmenities(prev => [...prev, trimmed]);
                        }
                        setNewAmenity('');
                      }
                    }}
                  />
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (newAmenity.trim()) {
                        const trimmed = newAmenity.trim();
                        if (!detectedAmenities.includes(trimmed)) {
                          setDetectedAmenities(prev => [...prev, trimmed]);
                          setSelectedAmenities(prev => [...prev, trimmed]);
                        }
                        setNewAmenity('');
                      }
                    }}
                    disabled={!newAmenity.trim()}
                  >
                    Add
                  </Button>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-base font-semibold">Review Images & Highlights</Label>
                </div>
                <p className="text-sm text-gray-600 mb-3">Review and edit your images and AI-generated highlights</p>
                
                {/* Image Review Grid */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
                  {imagePreviews.map((preview, index) => {
                    const imageHighlight = imageHighlights.find(h => h.imageIndexes.includes(index));
                    
                    const handleHighlightUpdate = (highlightIndex: number, newHighlight: { text: string; imageIndexes: number[] }) => {
                      const updatedHighlights = [...imageHighlights];
                      const existingIndex = updatedHighlights.findIndex(h => h.imageIndexes.includes(highlightIndex));
                      
                      if (existingIndex >= 0) {
                        updatedHighlights[existingIndex] = newHighlight;
                      } else {
                        updatedHighlights.push(newHighlight);
                      }
                      
                      setImageHighlights(updatedHighlights);
                    };
                    
                    return (
                      <ImageHighlightEditor
                        key={index}
                        preview={preview}
                        index={index}
                        highlight={imageHighlight}
                        onHighlightUpdate={handleHighlightUpdate}
                      />
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label htmlFor="description" className="text-base font-semibold">Generated Description *</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={regenerateDescription}
                    disabled={isRegeneratingDescription}
                    className="text-purple-600 hover:text-purple-700"
                  >
                    {isRegeneratingDescription ? (
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    ) : (
                      <Wand2 className="w-3 h-3 mr-1" />
                    )}
                    Regenerate
                  </Button>
                </div>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="AI will generate this"
                  rows={8}
                  className="resize-none"
                />
              </div>
            </>
          )}

          {/* Preview and Submit Buttons */}
          {hasGenerated && (
            <div className="flex justify-end space-x-3 pt-4 border-t">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button 
                variant="outline"
                onClick={() => setShowPreview(true)}
                className="border-blue-500 text-blue-500 hover:bg-blue-50"
              >
                <Eye className="w-4 h-4 mr-2" />
                Preview Listing
              </Button>
              <Button 
                onClick={handleSubmit}
                disabled={isCreating}
                className="bg-gradient-to-r from-green-500 to-teal-500 hover:from-green-600 hover:to-teal-600"
              >
                {isCreating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Publishing...
                  </>
                ) : (
                  'Publish Property'
                )}
              </Button>
            </div>
          )}
        </div>

        {/* Property Preview Modal */}
        <PropertyPreviewModal
          isOpen={showPreview}
          onClose={() => setShowPreview(false)}
          property={{
            id: 'preview',
            title,
            description,
            location,
            price: currency === 'USD' ? parseInt(price) * 24500 : parseInt(price),
            size: `${size}m²`,
            vibe: selectedStyles[0] || '',
            highlights: [...selectedStyles, ...selectedColors, ...selectedActivities],
            images: imagePreviews,
            realtor_id: 'preview',
            amenities: selectedAmenities,
            vibe_analysis: {
              ...vibeAnalysis,
              styles: selectedStyles,
              colors: selectedColors,
              activities: selectedActivities,
              amenities: selectedAmenities,
              generated_content: {
                ...vibeAnalysis?.generated_content,
                highlights: [...selectedStyles, ...selectedColors, ...selectedActivities]
              }
            },
            property_source_link: sourceLink,
            property_source_provider_name: sourceProviderName,
            property_source_provider_phone: sourceProviderPhone,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            is_active: true,
            last_activated_at: new Date().toISOString(),
            latitude: null,
            longitude: null,
          }}
        />

        {/* Property Highlight Editor Modal */}
        <PropertyHighlightEditor
          isOpen={showHighlightEditor}
          onClose={() => setShowHighlightEditor(false)}
          property={{
            id: 'preview',
            title,
            description,
            location,
            price: currency === 'USD' ? parseInt(price) * 24500 : parseInt(price),
            size: `${size}m²`,
            vibe: selectedStyles[0] || '',
            highlights: [...selectedStyles, ...selectedColors, ...selectedActivities],
            images: imagePreviews,
            realtor_id: 'preview',
            amenities: selectedAmenities,
            vibe_analysis: {
              ...vibeAnalysis,
              styles: selectedStyles,
              colors: selectedColors,
              activities: selectedActivities,
              amenities: selectedAmenities,
              generated_content: {
                ...vibeAnalysis?.generated_content,
                highlights: [...selectedStyles, ...selectedColors, ...selectedActivities]
              }
            },
            property_source_link: sourceLink,
            property_source_provider_name: sourceProviderName,
            property_source_provider_phone: sourceProviderPhone,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            is_active: true,
            last_activated_at: new Date().toISOString(),
            latitude: null,
            longitude: null,
          }}
          onHighlightsUpdate={handleHighlightsUpdate}
        />
      </Card>
    </div>
  );
};