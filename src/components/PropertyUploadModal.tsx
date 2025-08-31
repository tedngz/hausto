
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { X, Upload, Sparkles, MapPin, Loader2 } from 'lucide-react';
import { useProperties } from '@/hooks/useProperties';
import { useToast } from '@/hooks/use-toast';
import { CurrencySelector } from '@/components/CurrencySelector';
import { useCurrency } from '@/contexts/CurrencyContext';
import { supabase } from '@/integrations/supabase/client';

interface PropertyUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PropertyUploadModal = ({ isOpen, onClose }: PropertyUploadModalProps) => {
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [location, setLocation] = useState('');
  const [price, setPrice] = useState('');
  const [size, setSize] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedVibes, setSelectedVibes] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);

  const { createProperty, isCreating } = useProperties();
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
    'District 1, Ho Chi Minh City',
    'District 2, Ho Chi Minh City', 
    'District 3, Ho Chi Minh City',
    'District 7, Ho Chi Minh City',
    'Ba Dinh, Hanoi',
    'Hoan Kiem, Hanoi',
    'Cau Giay, Hanoi',
    'Dong Da, Hanoi'
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
      
      setImageFiles(prev => [...prev, ...filesToAdd]);
      
      // Process previews sequentially to avoid memory issues
      for (const file of filesToAdd) {
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
        
        // Auto-select vibes based on AI analysis of images, using only predefined vibe options
        const aiVibes = [];
        if (analysis.modern > 6) aiVibes.push('Modern');
        if (analysis.cozy > 6) aiVibes.push('Cozy');
        if (analysis.luxurious > 6) aiVibes.push('Luxury');
        if (analysis.urban > 6) aiVibes.push('Urban');
        if (analysis.spacious > 6) aiVibes.push('Natural Light');
        if (analysis.minimalist > 6) aiVibes.push('Minimalist');
        if (analysis.elegant > 6) aiVibes.push('Contemporary');
        if (analysis.natural_light > 7) aiVibes.push('Natural Light');
        
        // Add amenity-based vibes from image analysis
        if (analysis.rustic > 5) aiVibes.push('Rustic');
        if (analysis.colorful > 6) aiVibes.push('Bohemian');
        
        // Smart fallback vibes based on location and price if no image analysis vibes match
        if (aiVibes.length === 0) {
          const priceNum = parseInt(price);
          if (location.includes('District 1') || location.includes('Hoan Kiem')) {
            aiVibes.push('Urban', 'City Center');
          } else if (location.includes('District 2') || location.includes('Cau Giay')) {
            aiVibes.push('Modern', 'Pet Friendly');
          } else if (priceNum > 20000000) {
            aiVibes.push('Luxury', 'Modern');
          } else {
            aiVibes.push('Cozy', 'Traditional');
          }
        }
        
        // Always ensure at least 2 vibes are selected
        if (aiVibes.length === 1) {
          if (parseInt(price) > 15000000) {
            aiVibes.push('Luxury');
          } else {
            aiVibes.push('Cozy');
          }
        }
        
        // Remove duplicates and limit to 4 vibes
        const uniqueVibes = [...new Set(aiVibes)].slice(0, 4);
        setSelectedVibes(uniqueVibes);
      } else {
        // Fallback content if AI generation fails
        const locationShort = location.split(',')[0];
        const priceFormatted = currency === 'VND' ? `${(parseInt(price) / 1000000).toFixed(1)}M VND` : `$${Math.round(parseInt(price) / 24500)}`;
        
        setTitle(`Stunning ${size}m² Apartment in ${locationShort} - ${priceFormatted}/month`);
        setDescription(`Welcome to this exceptional ${size}m² property located in the heart of ${location}. This beautifully designed space offers the perfect blend of comfort and modern living.`);
        setSelectedVibes(['Modern', 'Natural Light']);
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
      setSelectedVibes(['Modern', 'Natural Light']);
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

    // Convert price to VND if in USD
    const priceInVND = currency === 'USD' ? parseInt(price) * 24500 : parseInt(price);

    createProperty({
      title,
      description,
      location,
      price: priceInVND,
      size: `${size}m²`,
      vibe: selectedVibes[0] || null,
      highlights: selectedVibes,
      imageFiles,
    });

    // Reset form
    setTitle('');
    setLocation('');
    setPrice('');
    setSize('');
    setDescription('');
    setSelectedVibes([]);
    setImageFiles([]);
    setImagePreviews([]);
    setHasGenerated(false);
    onClose();
  };

  const removeImage = (index: number) => {
    setImageFiles(prev => prev.filter((_, i) => i !== index));
    setImagePreviews(prev => prev.filter((_, i) => i !== index));
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
                <Label htmlFor="title" className="text-base font-semibold">Generated Title *</Label>
                <Input 
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="AI will generate this"
                  className="mt-2"
                />
              </div>

              <div>
                <Label className="text-base font-semibold">Selected Vibes</Label>
                <p className="text-sm text-gray-600 mb-3">AI has selected these vibes - you can modify them</p>
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

              <div>
                <Label htmlFor="description" className="text-base font-semibold">Generated Description *</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="AI will generate this"
                  rows={8}
                  className="resize-none mt-2"
                />
              </div>
            </>
          )}

          {/* Submit Button */}
          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button 
              onClick={handleSubmit}
              disabled={isCreating || !hasGenerated || !title || !location || !price || imageFiles.length === 0}
              className="bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600"
            >
              {isCreating ? 'Listing...' : 'List Property'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};
