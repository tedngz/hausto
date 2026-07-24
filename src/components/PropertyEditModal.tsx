import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { X, Upload, MapPin, Wand2, Eye, Sparkles, Loader2, RefreshCw } from 'lucide-react';
import { ImageHighlightEditor } from '@/components/ImageHighlightEditor';
import { PropertyPreviewModal } from '@/components/PropertyPreviewModal';
import { useProperties, Property } from '@/hooks/useProperties';
import { MapLocationPicker } from '@/components/MapLocationPicker';
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
  isExternal?: boolean;
}

export const PropertyEditModal = ({ isOpen, onClose, property, isExternal = false }: PropertyEditModalProps) => {
  const [newImageFiles, setNewImageFiles] = useState<File[]>([]);
  const [newImagePreviews, setNewImagePreviews] = useState<string[]>([]);
  const [existingImages, setExistingImages] = useState<string[]>([]);
  const [location, setLocation] = useState('');
  const [sourceLink, setSourceLink] = useState('');
  const [sourceProviderName, setSourceProviderName] = useState('');
  const [sourceProviderPhone, setSourceProviderPhone] = useState('');
  const [price, setPrice] = useState('');
  const [size, setSize] = useState('');
  const [rooms, setRooms] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedStyles, setSelectedStyles] = useState<string[]>([]);
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [selectedActivities, setSelectedActivities] = useState<string[]>([]);
  const [imageHighlights, setImageHighlights] = useState<{text: string, imageIndexes: number[]}[]>([]);
  const [currentVibeAnalysis, setCurrentVibeAnalysis] = useState<any>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isRegeneratingTitle, setIsRegeneratingTitle] = useState(false);
  const [isRegeneratingDescription, setIsRegeneratingDescription] = useState(false);
  const [isReanalyzing, setIsReanalyzing] = useState(false);
  const [detectedAmenities, setDetectedAmenities] = useState<string[]>([]);
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);
  const [newAmenity, setNewAmenity] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [aiDetectedVibes, setAiDetectedVibes] = useState<string[]>([]);
  const [pinLatitude, setPinLatitude] = useState<number | null>(null);
  const [pinLongitude, setPinLongitude] = useState<number | null>(null);

  const { updateProperty, isUpdating } = useProperties();
  const { toast } = useToast();
  const { currency, convertPrice } = useCurrency();
  const queryClient = useQueryClient();
  const [isSavingExternal, setIsSavingExternal] = useState(false);
  const [isRecrawling, setIsRecrawling] = useState(false);

  const handleRecrawlExternal = async () => {
    if (!property?.id || isRecrawling) return;
    if (!confirm('Re-scrape this listing from its source? This will overwrite the current title, description, images, amenities, and queue a fresh vibe analysis.')) return;
    setIsRecrawling(true);
    try {
      const { data, error } = await supabase.functions.invoke('recrawl-external-listing', {
        body: { id: property.id },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({
        title: 'Recrawl complete',
        description: `Saved ${(data as any)?.images_saved ?? 0} new images. Vibe analysis re-queued.`,
      });
      // Refresh data inside the modal and parent lists
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      queryClient.invalidateQueries({ queryKey: ['external-properties'] });
      onClose();
    } catch (e: any) {
      console.error('Recrawl failed:', e);
      toast({
        title: 'Recrawl failed',
        description: e?.message || 'Could not recrawl this listing.',
        variant: 'destructive',
      });
    } finally {
      setIsRecrawling(false);
    }
  };

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
      setRooms(property.rooms || '');
      
      // Extract styles, colors, activities from vibe_analysis or highlights
      const analysis = property.vibe_analysis || {};
      const savedHighlights = property.highlights || [];
      
      // Try to extract from saved structure first
      const savedStyles = analysis?.styles || [];
      const savedColors = analysis?.colors || [];
      const savedActivities = analysis?.activities || [];
      
      // If no saved structure, derive from AI analysis
      if (!savedStyles.length && !savedColors.length && !savedActivities.length && analysis) {
        const aiStyles = [];
        const aiColors = [];
        const aiActivities = [];
        
        // Extract styles (same logic as batch-reanalyze)
        if (analysis.modern >= 5) aiStyles.push('Modern');
        if (analysis.cozy >= 5) aiStyles.push('Cozy');
        if (analysis.luxurious >= 6) aiStyles.push('Luxury');
        if (analysis.urban >= 5) aiStyles.push('Urban');
        if (analysis.minimalist >= 5) aiStyles.push('Minimalist');
        if (analysis.elegant >= 5) aiStyles.push('Contemporary');
        if (analysis.rustic >= 4) aiStyles.push('Rustic');
        if (analysis.colorful >= 5) aiStyles.push('Bohemian');
        
        // Extract colors (map from available AI properties)
        if (analysis.minimalist >= 6 || (analysis.modern >= 6 && analysis.colorful < 5)) aiColors.push('Neutral');
        if (analysis.cozy >= 6 || analysis.rustic >= 5) aiColors.push('Warm');
        if (analysis.modern >= 7 || analysis.elegant >= 6) aiColors.push('Cool');
        if (analysis.natural_light >= 7) aiColors.push('Bright');
        if (analysis.colorful >= 6) aiColors.push('Colorful');
        if (analysis.natural_light >= 6 && analysis.cozy >= 5) aiColors.push('Natural');
        if (analysis.minimalist >= 7) aiColors.push('White');
        if (analysis.rustic >= 6 || (analysis.cozy >= 6 && analysis.natural_light >= 5)) aiColors.push('Earth');
        if (analysis.colorful >= 7 || (analysis.modern >= 7 && analysis.colorful >= 5)) aiColors.push('Bold');
        
        // Extract activities (map from available AI properties)
        if (analysis.modern >= 6 || analysis.spacious >= 7) aiActivities.push('Working');
        if ((analysis.cozy >= 6 && analysis.natural_light >= 6) || analysis.natural_light >= 8) aiActivities.push('Reading');
        if (analysis.cozy >= 6 || analysis.elegant >= 6) aiActivities.push('Relaxing');
        if (analysis.spacious >= 7 || (analysis.modern >= 6 && analysis.spacious >= 5) || analysis.luxurious >= 7) aiActivities.push('Entertaining');
        if (analysis.spacious >= 6 && analysis.modern >= 5) aiActivities.push('Cooking');
        if (analysis.spacious >= 8) aiActivities.push('Exercising');
        
        // Remove duplicates and limit selections
        const uniqueStyles = [...new Set(aiStyles)].slice(0, 3);
        const uniqueColors = [...new Set(aiColors)].slice(0, 3);
        const uniqueActivities = [...new Set(aiActivities)].slice(0, 3);
        
        setSelectedStyles(uniqueStyles.length ? uniqueStyles : ['Modern']);
        setSelectedColors(uniqueColors.length ? uniqueColors : ['Neutral']);
        setSelectedActivities(uniqueActivities.length ? uniqueActivities : ['Relaxing']);
      } else {
        setSelectedStyles(savedStyles);
        setSelectedColors(savedColors);
        setSelectedActivities(savedActivities);
      }
      
      // Extract image highlights - build array parallel to images
      const allImages = property.images || [];
      if (property.vibe_analysis?.image_analyses && Array.isArray(property.vibe_analysis.image_analyses)) {
        // Create a map of image_index -> highlight
        const highlightMap = new Map<number, string>();
        
        // Check if database uses 1-based indexing (legacy AI data)
        const indices = property.vibe_analysis.image_analyses
          .map((a: any) => Number(a.image_index))
          .filter(n => Number.isFinite(n));
        const minIndex = indices.length > 0 ? Math.min(...indices) : 0;
        const isOneBased = minIndex === 1 && indices.length === allImages.length;
        
        property.vibe_analysis.image_analyses.forEach((imgAnalysis: any) => {
          if (imgAnalysis.image_highlight) {
            let rawIdx = Number(imgAnalysis.image_index);
            // Convert 1-based to 0-based if needed
            if (isOneBased && rawIdx >= 1) {
              rawIdx = rawIdx - 1;
            }
            const imageIndex = Number.isFinite(rawIdx) && rawIdx >= 0 ? rawIdx : 0;
            highlightMap.set(imageIndex, imgAnalysis.image_highlight);
          }
        });
        
        // Build highlights array parallel to images array
        const highlightsArray = allImages.map((_, idx) => {
          const text = highlightMap.get(idx) || '';
          return { text, imageIndexes: [idx] };
        });
        setImageHighlights(highlightsArray);
      } else {
        // Initialize empty highlights for all images
        setImageHighlights(allImages.map((_, idx) => ({ text: '', imageIndexes: [idx] })));
      }
      
      setCurrentVibeAnalysis(property.vibe_analysis);
      setExistingImages(property.images || []);
      setPinLatitude((property as any).latitude ?? null);
      setPinLongitude((property as any).longitude ?? null);

      // Amenities: show AI-detected + saved; select saved if present otherwise AI
      const savedAmenities: string[] = (property as any).amenities || [];
      const aiAmenities: string[] = Array.isArray(analysis?.amenities) ? analysis.amenities : [];
      const imageSuggested: string[] = Array.isArray(property.vibe_analysis?.image_analyses)
        ? property.vibe_analysis.image_analyses.flatMap((ia: any) => Array.isArray(ia.suggested_amenities) ? ia.suggested_amenities : [])
        : [];
      const detected = Array.from(new Set([...(aiAmenities || []), ...imageSuggested, ...(savedAmenities || [])]));
      setDetectedAmenities(detected);
      setSelectedAmenities(savedAmenities.length ? savedAmenities : Array.from(new Set([...(aiAmenities || []), ...imageSuggested])));

    }
  }, [property, convertPrice]);

  // Ensure we load fresh amenities when modal opens or property data changes (after batch re-analyze updates)
  useEffect(() => {
    let cancelled = false;
    const fetchFresh = async () => {
      if (!isOpen || !property?.id) return;
      
      const table = isExternal ? 'external_properties' : 'properties';
      const selectFields = isExternal
        ? 'id, amenities, vibe_analysis, highlights, images, title, description, location, price, size, source_url, updated_at'
        : 'id, amenities, vibe_analysis, highlights, images, title, description, location, price, size, property_source_link, property_source_provider_name, property_source_provider_phone, updated_at';
      
      const { data: fresh, error } = await supabase
        .from(table)
        .select(selectFields)
        .eq('id', property.id)
        .single();
      if (error) {
        console.error('Failed to fetch fresh property for edit modal:', error);
        return;
      }
      if (!cancelled && fresh && isExternal) {
        const { data: contactRows } = await supabase.rpc('get_external_property_contact', { _property_id: property.id });
        const contact = Array.isArray(contactRows) ? contactRows[0] : contactRows;
        (fresh as any).contact_name = contact?.contact_name ?? null;
        (fresh as any).contact_phone = contact?.contact_phone ?? null;
      }
      if (!cancelled && fresh) {
        const analysis = (fresh as any)?.vibe_analysis || {};
        
        // Extract and update image highlights - use same logic as main useEffect
        const allImages = (fresh as any)?.images || [];
        if (analysis?.image_analyses && Array.isArray(analysis.image_analyses)) {
          const highlightMap = new Map<number, string>();
          
          // Check if database uses 1-based indexing (legacy AI data)
          const indices = analysis.image_analyses
            .map((a: any) => Number(a.image_index))
            .filter(n => Number.isFinite(n));
          const minIndex = indices.length > 0 ? Math.min(...indices) : 0;
          const isOneBased = minIndex === 1 && indices.length === allImages.length;
          
          analysis.image_analyses.forEach((imgAnalysis: any) => {
            if (imgAnalysis.image_highlight) {
              let rawIdx = Number(imgAnalysis.image_index);
              // Convert 1-based to 0-based if needed
              if (isOneBased && rawIdx >= 1) {
                rawIdx = rawIdx - 1;
              }
              const imageIndex = Number.isFinite(rawIdx) && rawIdx >= 0 ? rawIdx : 0;
              highlightMap.set(imageIndex, imgAnalysis.image_highlight);
            }
          });
          
          // Build highlights array parallel to images array
          const highlightsArray = allImages.map((_, idx) => {
            const text = highlightMap.get(idx) || '';
            return { text, imageIndexes: [idx] };
          });
          setImageHighlights(highlightsArray);
          console.log('[PropertyEditModal] Loaded image highlights:', highlightsArray);
        }
        
        // Extract and update amenities
        const savedAmenities: string[] = (fresh as any)?.amenities || [];
        const aiAmenities: string[] = Array.isArray(analysis?.amenities) ? analysis.amenities : [];
        const imageSuggested: string[] = Array.isArray(analysis?.image_analyses)
          ? analysis.image_analyses.flatMap((ia: any) => Array.isArray(ia.suggested_amenities) ? ia.suggested_amenities : [])
          : [];
        const detected = Array.from(new Set([...(aiAmenities || []), ...imageSuggested, ...(savedAmenities || [])]));
        setDetectedAmenities(detected);
        // Always refresh selected amenities from saved data after re-analyze
        setSelectedAmenities(savedAmenities.length ? savedAmenities : Array.from(new Set([...(aiAmenities || []), ...imageSuggested])));
        console.log('[PropertyEditModal] Loaded amenities - detected:', detected.length, 'selected:', savedAmenities.length || imageSuggested.length);
      }
    };
    fetchFresh();
    return () => { cancelled = true; };
  }, [isOpen, property?.id, property?.updated_at]);

  // Live-refresh amenities when property is re-analyzed elsewhere (e.g., batch)
  useEffect(() => {
    if (!isOpen || !property?.id || isExternal) return;

    const channelId = `property-updates-${property.id}-${Math.random().toString(36).substring(2, 9)}`;
    const channel = supabase
      .channel(channelId)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'properties', filter: `id=eq.${property.id}` },
        async () => {
          try {
            const { data: fresh, error } = await supabase
              .from('properties')
              .select('id, amenities, vibe_analysis, highlights, images, updated_at')
              .eq('id', property.id)
              .single();
            if (error || !fresh) return;

            const analysis: any = (fresh as any).vibe_analysis || {};

            // Update image highlights (keep indices in UI 0-based)
            if (Array.isArray(analysis.image_analyses)) {
              const highlightsWithImages = analysis.image_analyses
                .map((ia: any) => {
                  if (!ia?.image_highlight) return null;
                  const rawIdx = Number(ia.image_index);
                  const imageIndex = Math.max(0, (Number.isFinite(rawIdx) ? rawIdx : 1) - 1);
                  return { text: ia.image_highlight, imageIndexes: [imageIndex] };
                })
                .filter(Boolean);
              setImageHighlights(highlightsWithImages as any);
            }

            // Merge amenities from overall analysis + image suggestions + saved
            const savedAmenities: string[] = (fresh as any).amenities || [];
            const aiAmenities: string[] = Array.isArray(analysis.amenities) ? analysis.amenities : [];
            const imageSuggested: string[] = Array.isArray(analysis.image_analyses)
              ? analysis.image_analyses.flatMap((ia: any) =>
                  Array.isArray(ia?.suggested_amenities) ? ia.suggested_amenities : []
                )
              : [];
            const detected = Array.from(new Set([...(aiAmenities || []), ...imageSuggested, ...(savedAmenities || [])]));
            setDetectedAmenities(detected);
            setSelectedAmenities(savedAmenities.length ? savedAmenities : Array.from(new Set([...(aiAmenities || []), ...imageSuggested])));
          } catch (e) {
            console.error('[PropertyEditModal] Realtime refresh failed:', e);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isOpen, property?.id]);
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
        
        // Extract and set amenities (merge overall + image-suggested) - always update
        const aiAmenities: string[] = Array.isArray(analysis.amenities) ? analysis.amenities : [];
        const imageSuggested: string[] = Array.isArray(analysis.image_analyses)
          ? analysis.image_analyses.flatMap((ia: any) => Array.isArray(ia?.suggested_amenities) ? ia.suggested_amenities : [])
          : [];
        const mergedAmenities = Array.from(new Set([...(aiAmenities || []), ...imageSuggested]));
        
        console.log('[PropertyEditModal] Regenerate - Extracted amenities:', { 
          aiAmenities, 
          imageSuggested, 
          mergedAmenities 
        });
        
        // Always update amenities
        setDetectedAmenities(mergedAmenities);
        setSelectedAmenities(mergedAmenities);
        
        // Extract styles, colors, and activities from AI analysis
        const aiStyles = [];
        const aiColors = [];
        const aiActivities = [];
        
        // Extract styles with lower thresholds
        if (analysis.modern >= 5) aiStyles.push('Modern');
        if (analysis.cozy >= 5) aiStyles.push('Cozy');
        if (analysis.luxurious >= 5) aiStyles.push('Luxury');
        if (analysis.urban >= 5) aiStyles.push('Urban');
        if (analysis.minimalist >= 5) aiStyles.push('Minimalist');
        if (analysis.elegant >= 5) aiStyles.push('Contemporary');
        if (analysis.rustic >= 4) aiStyles.push('Rustic');
        if (analysis.industrial >= 4) aiStyles.push('Industrial');
        
        // Extract colors with lower thresholds
        if (analysis.neutral >= 5) aiColors.push('Neutral');
        if (analysis.warm >= 5) aiColors.push('Warm');
        if (analysis.cool >= 5) aiColors.push('Cool');
        if (analysis.bright >= 5 || analysis.natural_light >= 6) aiColors.push('Bright');
        if (analysis.colorful >= 5) aiColors.push('Colorful');
        if (analysis.natural_light >= 6) aiColors.push('Natural');
        
        // Extract activities with lower thresholds
        if (analysis.modern >= 5 || analysis.spacious >= 5) aiActivities.push('Working');
        if (analysis.cozy >= 5 || analysis.natural_light >= 6) aiActivities.push('Reading');
        if (analysis.cozy >= 5 || analysis.elegant >= 5) aiActivities.push('Relaxing');
        if (analysis.spacious >= 5 || analysis.modern >= 5) aiActivities.push('Entertaining');
        
        // Ensure we always have at least one item in each category
        const uniqueStyles = [...new Set(aiStyles)].slice(0, 3);
        const uniqueColors = [...new Set(aiColors)].slice(0, 3);
        const uniqueActivities = [...new Set(aiActivities)].slice(0, 3);
        
        // If any category is empty, add default values
        if (uniqueStyles.length === 0) uniqueStyles.push('Modern');
        if (uniqueColors.length === 0) uniqueColors.push('Neutral');
        if (uniqueActivities.length === 0) uniqueActivities.push('Relaxing');
        
        setSelectedStyles(uniqueStyles);
        setSelectedColors(uniqueColors);
        setSelectedActivities(uniqueActivities);

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

  const reanalyzeCategories = async () => {
    const allImages = [...existingImages, ...newImagePreviews];
    
    if (allImages.length === 0) {
      toast({
        title: "No Images",
        description: "Please add images to re-analyze categories.",
        variant: "destructive"
      });
      return;
    }

    setIsReanalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-vibe', {
        body: {
          imageUrls: allImages,
          generateContent: false
        }
      });

      if (error) throw error;

      const analysis = data?.analysis;

      if (analysis) {
        // Extract styles, colors, and activities from AI analysis
        const aiStyles = [];
        const aiColors = [];
        const aiActivities = [];
        
        // Extract styles with lower thresholds
        if (analysis.modern >= 5) aiStyles.push('Modern');
        if (analysis.cozy >= 5) aiStyles.push('Cozy');
        if (analysis.luxurious >= 5) aiStyles.push('Luxury');
        if (analysis.urban >= 5) aiStyles.push('Urban');
        if (analysis.minimalist >= 5) aiStyles.push('Minimalist');
        if (analysis.elegant >= 5) aiStyles.push('Contemporary');
        if (analysis.rustic >= 4) aiStyles.push('Rustic');
        if (analysis.industrial >= 4) aiStyles.push('Industrial');
        
        // Extract colors with lower thresholds
        if (analysis.neutral >= 5) aiColors.push('Neutral');
        if (analysis.warm >= 5) aiColors.push('Warm');
        if (analysis.cool >= 5) aiColors.push('Cool');
        if (analysis.bright >= 5 || analysis.natural_light >= 6) aiColors.push('Bright');
        if (analysis.colorful >= 5) aiColors.push('Colorful');
        if (analysis.natural_light >= 6) aiColors.push('Natural');
        
        // Extract activities with lower thresholds
        if (analysis.modern >= 5 || analysis.spacious >= 5) aiActivities.push('Working');
        if (analysis.cozy >= 5 || analysis.natural_light >= 6) aiActivities.push('Reading');
        if (analysis.cozy >= 5 || analysis.elegant >= 5) aiActivities.push('Relaxing');
        if (analysis.spacious >= 5 || analysis.modern >= 5) aiActivities.push('Entertaining');
        
        // Ensure we always have at least one item in each category
        const uniqueStyles = [...new Set(aiStyles)].slice(0, 3);
        const uniqueColors = [...new Set(aiColors)].slice(0, 3);
        const uniqueActivities = [...new Set(aiActivities)].slice(0, 3);
        
        // If any category is empty, add default values
        if (uniqueStyles.length === 0) uniqueStyles.push('Modern');
        if (uniqueColors.length === 0) uniqueColors.push('Neutral');
        if (uniqueActivities.length === 0) uniqueActivities.push('Relaxing');
        
        setSelectedStyles(uniqueStyles);
        setSelectedColors(uniqueColors);
        setSelectedActivities(uniqueActivities);

        // Extract and set amenities - always update, even if empty
        const aiAmenities: string[] = Array.isArray(analysis.amenities) ? analysis.amenities : [];
        const imageSuggested: string[] = Array.isArray(analysis.image_analyses)
          ? analysis.image_analyses.flatMap((ia: any) => Array.isArray(ia?.suggested_amenities) ? ia.suggested_amenities : [])
          : [];
        const mergedAmenities = Array.from(new Set([...(aiAmenities || []), ...imageSuggested]));
        
        console.log('[PropertyEditModal] Extracted amenities:', { 
          aiAmenities, 
          imageSuggested, 
          mergedAmenities,
          analysisObject: analysis 
        });
        
        // Always update amenities, even if the list is empty (to clear previous values)
        setDetectedAmenities(mergedAmenities);
        setSelectedAmenities(mergedAmenities);

        toast({
          title: "Categories Re-analyzed!",
          description: "AI has updated styles, colors, activities, and amenities.",
        });
      }
    } catch (error) {
      console.error('Error reanalyzing categories:', error);
      toast({
        title: "Re-analysis Failed",
        description: "Failed to re-analyze categories. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsReanalyzing(false);
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

    // Merge edited per-image highlights into vibe_analysis.image_analyses before saving
    const existingAnalyses = Array.isArray(currentVibeAnalysis?.image_analyses)
      ? currentVibeAnalysis.image_analyses
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

    const mergedVibeAnalysis = {
      ...currentVibeAnalysis,
      image_analyses: mergedImageAnalyses,
      styles: selectedStyles,
      colors: selectedColors,
      activities: selectedActivities,
      amenities: selectedAmenities
    };

    if (isExternal) {
      // Save directly to external_properties table
      saveExternalProperty(property.id, priceInVND, mergedVibeAnalysis);
    } else {
      updateProperty({
        id: property.id,
        title,
        description,
        location,
        price: priceInVND,
        size: size ? `${size}m²` : undefined,
        vibe: selectedStyles[0] || null,
        highlights: [...selectedStyles, ...selectedColors, ...selectedActivities],
        vibeAnalysis: mergedVibeAnalysis,
        newImageFiles,
        existingImages,
        amenities: selectedAmenities,
        propertySourceLink: sourceLink,
        propertySourceProviderName: sourceProviderName,
        propertySourceProviderPhone: sourceProviderPhone,
        latitude: pinLatitude,
        longitude: pinLongitude,
        rooms: rooms || undefined,
      });

      // Reset form
      setNewImageFiles([]);
      setNewImagePreviews([]);
      onClose();
    }
  };

  const saveExternalProperty = async (id: string, priceInVND: number, vibeAnalysis: any) => {
    setIsSavingExternal(true);
    try {
      const { error } = await supabase
        .from('external_properties')
        .update({
          title,
          description,
          location,
          price: priceInVND,
          size: size ? `${size}m²` : undefined,
          rooms: rooms || null,
          vibe: selectedStyles[0] || null,
          highlights: [...selectedStyles, ...selectedColors, ...selectedActivities],
          vibe_analysis: vibeAnalysis,
          amenities: selectedAmenities,
          contact_name: sourceProviderName || null,
          contact_phone: sourceProviderPhone || null,
          source_url: sourceLink || '',
          latitude: pinLatitude,
          longitude: pinLongitude,
          images: existingImages,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (error) throw error;

      // Invalidate caches
      queryClient.invalidateQueries({ queryKey: ['crawled-listings'] });
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      supabase.functions.invoke('property-discovery-cache', {
        body: { action: 'invalidate' },
      });

      toast({
        title: "External Listing Updated!",
        description: "The crawled listing has been successfully updated.",
      });

      setNewImageFiles([]);
      setNewImagePreviews([]);
      onClose();
    } catch (error) {
      console.error('Error updating external property:', error);
      toast({
        title: "Error",
        description: "Failed to update external listing. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSavingExternal(false);
    }
  };

  if (!isOpen || !property) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4">
      <Card className="w-full sm:max-w-4xl max-h-[95vh] sm:max-h-[90vh] overflow-y-auto bg-white rounded-t-2xl sm:rounded-xl">
        <div className="flex items-center justify-between p-4 sm:p-6 border-b sticky top-0 bg-white z-10">
          <div className="min-w-0">
            <h2 className="text-lg sm:text-2xl font-bold text-gray-900 truncate">{isExternal ? 'Edit External Listing' : 'Edit Property'}</h2>
            <p className="text-sm text-gray-600 hidden sm:block">{isExternal ? 'Update this crawled listing' : 'Update your property listing'}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isExternal && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRecrawlExternal}
                disabled={isRecrawling}
                title="Re-scrape title, description, images, and amenities from the source URL"
              >
                {isRecrawling ? (
                  <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Recrawling…</>
                ) : (
                  <><RefreshCw className="w-4 h-4 mr-1" /> Recrawl from source</>
                )}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        <div className="p-4 sm:p-6 space-y-5 sm:space-y-6">
          {/* Step 1: Upload and Manage Images */}
          <div className="space-y-4">
            <div>
              <Label className="text-base font-semibold">Property Images *</Label>
              <p className="text-sm text-gray-600 mb-3">Upload images of your property</p>
              
              <div className="space-y-4">
                {/* Image Upload Area */}
                <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                  <div className="flex flex-col items-center justify-center pt-5 pb-6">
                    <Upload className="w-8 h-8 text-gray-400 mb-2" />
                    <p className="text-sm text-gray-600">Click to upload images</p>
                    <p className="text-xs text-gray-500 mt-1">PNG, JPG, AVIF up to 10 images</p>
                  </div>
                  <input 
                    type="file" 
                    multiple 
                    accept="image/*" 
                    className="hidden" 
                    onChange={handleNewImageUpload}
                  />
                </label>

                {/* Image Grid */}
                {(existingImages.length > 0 || newImagePreviews.length > 0) && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-3">
                    {existingImages.map((img, index) => (
                      <div key={`existing-${index}`} className="relative group">
                        <img loading="lazy" 
                          src={img} 
                          alt={`Property ${index + 1}`} 
                          className="w-full h-24 object-cover rounded-lg"
                        />
                        <button
                          onClick={() => removeExistingImage(index)}
                          className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    {newImagePreviews.map((img, index) => (
                      <div key={`new-${index}`} className="relative group">
                        <img loading="lazy" 
                          src={img} 
                          alt={`New ${index + 1}`} 
                          className="w-full h-24 object-cover rounded-lg"
                        />
                        <button
                          onClick={() => removeNewImage(index)}
                          className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Step 2: Basic Information */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
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
              <Label htmlFor="edit-size">Size (m²) *</Label>
              <Input 
                id="edit-size"
                type="number"
                value={size}
                onChange={(e) => setSize(e.target.value)}
                placeholder="e.g., 75"
              />
            </div>
            <div>
              <Label htmlFor="edit-rooms">Apartment Type (Optional)</Label>
              <select
                id="edit-rooms"
                value={rooms}
                onChange={(e) => setRooms(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Select type...</option>
                <option value="Studio">Studio</option>
                <option value="1 Bedroom">1 Bedroom</option>
                <option value="2 Bedrooms">2 Bedrooms</option>
                <option value="3 Bedrooms">3 Bedrooms</option>
                <option value="4+ Bedrooms">4+ Bedrooms</option>
                <option value="Penthouse">Penthouse</option>
                <option value="Shared Room">Shared Room</option>
              </select>
            </div>
          </div>

          <MapLocationPicker
            latitude={pinLatitude}
            longitude={pinLongitude}
            onLocationChange={(lat, lng) => { setPinLatitude(lat); setPinLongitude(lng); }}
            locationText={location}
          />

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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
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
                onClick={regenerateContent}
                disabled={isRegenerating || (existingImages.length === 0 && newImagePreviews.length === 0)}
                className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
              >
                {isRegenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Regenerate Content with AI
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Property Title - After Monthly Rent */}
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

          {/* Step 3: AI Generated Content */}
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-base font-semibold">AI Selected Style</Label>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={reanalyzeCategories}
                      disabled={isReanalyzing}
                      className="text-purple-600 hover:text-purple-700"
                    >
                      {isReanalyzing ? (
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      ) : (
                        <Wand2 className="w-3 h-3 mr-1" />
                      )}
                      Re-analyze
                    </Button>
                  </div>
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
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-base font-semibold">AI Selected Color</Label>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={reanalyzeCategories}
                      disabled={isReanalyzing}
                      className="text-purple-600 hover:text-purple-700"
                    >
                      {isReanalyzing ? (
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      ) : (
                        <Wand2 className="w-3 h-3 mr-1" />
                      )}
                      Re-analyze
                    </Button>
                  </div>
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
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-base font-semibold">AI Selected Activity</Label>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={reanalyzeCategories}
                      disabled={isReanalyzing}
                      className="text-purple-600 hover:text-purple-700"
                    >
                      {isReanalyzing ? (
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      ) : (
                        <Wand2 className="w-3 h-3 mr-1" />
                      )}
                      Re-analyze
                    </Button>
                  </div>
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

          {/* Amenities Section - Moved above images */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-base font-semibold">AI-detected Amenities</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={reanalyzeCategories}
                disabled={isReanalyzing}
                className="text-purple-600 hover:text-purple-700"
              >
                {isReanalyzing ? (
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                ) : (
                  <Wand2 className="w-3 h-3 mr-1" />
                )}
                Re-analyze
              </Button>
            </div>
            <p className="text-sm text-gray-600 mb-3">Click to select/deselect which detected amenities to save</p>
            
            <div className="flex flex-wrap gap-2 mb-4">
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

          {/* Image Highlights Section */}
          {(existingImages.length > 0 || newImagePreviews.length > 0) && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <Label className="text-base font-semibold">Review Images & Highlights</Label>
              </div>
              <p className="text-sm text-gray-600 mb-3">Review and edit your images and AI-generated highlights</p>
              
              {/* Image Review Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3 mb-4">
                {[...existingImages, ...newImagePreviews].map((preview, index) => {
                  const imageHighlight = imageHighlights[index] || { text: '', imageIndexes: [index] };
                  
                  const handleHighlightUpdate = (highlightIndex: number, newHighlight: { text: string; imageIndexes: number[] }) => {
                    setImageHighlights(prev => {
                      const updated = [...prev];
                      // Ensure array is large enough
                      while (updated.length <= highlightIndex) {
                        updated.push({ text: '', imageIndexes: [updated.length] });
                      }
                      updated[highlightIndex] = newHighlight;
                      return updated;
                    });
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
          )}

          {/* Description Section */}
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

          {/* Preview and Submit Buttons */}
          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3 pt-4 border-t">
            <Button variant="outline" onClick={onClose} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button 
              variant="outline"
              onClick={() => setShowPreview(true)}
              className="w-full sm:w-auto border-blue-500 text-blue-500 hover:bg-blue-50"
            >
              <Eye className="w-4 h-4 mr-2" />
              Preview
            </Button>
            <Button 
              onClick={handleSubmit}
              disabled={(isUpdating || isSavingExternal) || !title || !location || !price}
              className="w-full sm:w-auto bg-gradient-to-r from-green-500 to-teal-500 hover:from-green-600 hover:to-teal-600"
            >
              {(isUpdating || isSavingExternal) ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Updating...
                </>
              ) : (
                isExternal ? 'Update Listing' : 'Update Property'
              )}
            </Button>
          </div>
        </div>
      </Card>

      {/* Preview Modal */}
      {showPreview && property && (() => {
        // Build preview image_analyses by merging current analysis with in-editor edits
        const existingAnalyses = Array.isArray(currentVibeAnalysis?.image_analyses)
          ? currentVibeAnalysis.image_analyses
          : [];
        const analysesByIndex = new Map<number, any>(
          existingAnalyses.map((a: any) => [Number(a?.image_index) || 0, a])
        );
        imageHighlights.forEach((h) => {
          const idx = (h.imageIndexes && h.imageIndexes[0] !== undefined) ? h.imageIndexes[0] : 0;
          const prev = analysesByIndex.get(idx) || { image_index: idx };
          analysesByIndex.set(idx, { ...prev, image_index: idx, image_highlight: h.text });
        });
        const previewImageAnalyses = Array.from(analysesByIndex.values());

        return (
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
              highlights: [...selectedStyles, ...selectedColors, ...selectedActivities],
              images: [...existingImages, ...newImagePreviews],
              vibe_analysis: {
                ...currentVibeAnalysis,
                image_analyses: previewImageAnalyses,
                styles: selectedStyles,
                colors: selectedColors,
                activities: selectedActivities,
                amenities: selectedAmenities
              },
              amenities: selectedAmenities,
              property_source_link: sourceLink,
              property_source_provider_name: sourceProviderName,
              property_source_provider_phone: sourceProviderPhone,
            }}
          />
        );
      })()}
    </div>
  );
};
