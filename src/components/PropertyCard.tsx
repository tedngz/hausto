import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MapPin, User, ChevronDown, ChevronUp, Sparkles, ExternalLink, Share2, Loader2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { MapViewModal } from '@/components/MapViewModal';
import { Apartment, UserPreferences } from '@/types';
import { VibeScore } from '@/components/VibeScore';
import { VibeScoreBar } from '@/components/VibeScoreBar';
import { PropertyHighlightTags } from '@/components/PropertyHighlightTags';
import { PropertyImageModal } from '@/components/PropertyImageModal';
import { calculateVibeScore } from '@/utils/vibeScoring';
import { getVibeRatingLabel, getVibeRatingColor } from '@/utils/vibeRating';
import { useCurrency } from '@/contexts/CurrencyContext';
import { getPropertySourceLogo } from '@/utils/propertySourceLogos';
import { PropertyAmenities } from '@/components/PropertyAmenities';
import { geocodeLocation } from '@/utils/geocoding';
import { translateLocationToEnglish } from '@/utils/locationTranslation';
interface PropertyCardProps {
  apartment: Apartment;
  userPreferences?: UserPreferences;
  onContact?: () => void;
  showContactButton?: boolean;
  className?: string;
  showFullTitle?: boolean;
  showFullDescription?: boolean;
  showAllHighlights?: boolean;
  hideVibeScore?: boolean;
  isAnonymous?: boolean;
  hasDeleteButton?: boolean;
  showRealtorInfo?: boolean;
  isOwnProperty?: boolean;
}

const normalizeRepeatedTitle = (title: string) => {
  const clean = title.replace(/\s+/g, ' ').trim();
  const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
  const tokens = clean.split(' ');

  for (let size = Math.floor(tokens.length / 2); size >= 2; size -= 1) {
    for (let i = 0; i + size * 2 <= tokens.length; i += 1) {
      const first = normalize(tokens.slice(i, i + size).join(' '));
      const second = normalize(tokens.slice(i + size, i + size * 2).join(' '));
      if (first && first === second) {
        return [...tokens.slice(0, i + size), ...tokens.slice(i + size * 2)].join(' ');
      }
    }
  }

  const parts = clean.split(/\s+([|•·]|-{2,}|–|—)\s+/);
  const seen = new Set<string>();
  return parts.reduce<string[]>((acc, part) => {
    const key = normalize(part);
    if (key && !/^[|•·–—-]+$/.test(part)) {
      if (seen.has(key)) return acc;
      seen.add(key);
    }
    acc.push(part);
    return acc;
  }, []).join(' ').replace(/\s+([|•·–—-])\s*$/g, '').trim();
};

export const PropertyCard = ({
  apartment,
  userPreferences,
  onContact,
  showContactButton = true,
  className = "",
  showFullTitle = false,
  showFullDescription = false,
  showAllHighlights = false,
  hideVibeScore = false,
  isAnonymous = false,
  hasDeleteButton = false,
  showRealtorInfo = true,
  isOwnProperty = false
}: PropertyCardProps) => {
  // Use provided image index from SwipeInterface or maintain own state
  const externalImageIndex = (apartment as any)._currentImageIndex;
  const [currentImageIndex, setCurrentImageIndex] = useState(externalImageIndex || 0);
  const [expandedDescription, setExpandedDescription] = useState(false);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [geocodedCoords, setGeocodedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isGeocoding, setIsGeocoding] = useState(false);

  const hasCoords = !!(apartment.latitude && apartment.longitude);
  const mapLat = hasCoords ? apartment.latitude! : geocodedCoords?.lat ?? 0;
  const mapLng = hasCoords ? apartment.longitude! : geocodedCoords?.lng ?? 0;
  const canShowMap = hasCoords || !!geocodedCoords;

  const handleLocationClick = useCallback(async () => {
    if (hasCoords) {
      setIsMapOpen(true);
      return;
    }
    if (geocodedCoords) {
      setIsMapOpen(true);
      return;
    }
    // On-demand geocode
    setIsGeocoding(true);
    try {
      const coords = await geocodeLocation(apartment.location);
      if (coords) {
        setGeocodedCoords(coords);
        setIsMapOpen(true);
      } else {
        toast({ title: "Location not found", description: "Could not find this address on the map.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Geocoding failed", description: "Could not look up the location.", variant: "destructive" });
    } finally {
      setIsGeocoding(false);
    }
  }, [hasCoords, geocodedCoords, apartment.location]);
  const {
    formatPrice
  } = useCurrency();
  const displayLocation = useMemo(() => translateLocationToEnglish(apartment.location), [apartment.location]);
  const displayTitle = useMemo(() => normalizeRepeatedTitle(apartment.title ?? ''), [apartment.title]);
  const descriptionDuplicatesTitle = useMemo(() => {
    const description = apartment.description?.trim().toLowerCase();
    const rawTitle = (apartment.title ?? '').trim().toLowerCase();
    const cleanedTitle = displayTitle.trim().toLowerCase();
    return !!description && (description === rawTitle || description === cleanedTitle);
  }, [apartment.description, apartment.title, displayTitle]);

  // Update internal image index when external index changes (for SwipeInterface)
  useEffect(() => {
    if (externalImageIndex !== undefined) {
      setCurrentImageIndex(externalImageIndex);
    }
  }, [externalImageIndex]);

  // Always calculate vibe score - use default preferences if none provided
  const defaultPreferences: UserPreferences = {
    styles: ['modern', 'minimalist'],
    colors: ['neutral', 'warm'],
    activities: ['relaxing', 'working'],
    priceRange: [1000, 5000] as [number, number],
    size: '1-2 bedrooms',
    location: ['any'],
    moveInDate: new Date().toISOString()
  };
  const vibeScore = calculateVibeScore(apartment, userPreferences || defaultPreferences);
  const handleShare = async () => {
    const shareUrl = `${window.location.origin}/property/${apartment.id}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast({
        title: "Link Copied!",
        description: "Property link has been copied to your clipboard."
      });
    } catch (error) {
      console.error('Failed to copy link:', error);
      toast({
        title: "Failed to copy",
        description: "Please try again.",
        variant: "destructive"
      });
    }
  };

  // Highlight categorization and styling
  const getHighlightCategory = (highlight: string): 'style' | 'color' | 'activity' => {
    const h = highlight.toLowerCase();
    const style = ['modern', 'traditional', 'minimalist', 'bohemian', 'industrial', 'scandinavian', 'contemporary', 'rustic', 'vintage', 'luxury', 'urban', 'cozy', 'sleek', 'elegant', 'chic'];
    const color = ['warm', 'cool', 'neutral', 'bold', 'bright', 'dark', 'colorful', 'white', 'black', 'grey', 'beige', 'wood', 'natural', 'light'];
    const activity = ['working', 'entertaining', 'relaxing', 'cooking', 'exercising', 'reading', 'creating', 'dining', 'sleeping', 'studying', 'socializing'];
    if (style.some(k => h.includes(k))) return 'style';
    if (color.some(k => h.includes(k))) return 'color';
    if (activity.some(k => h.includes(k))) return 'activity';
    return 'style';
  };
  const categoryClasses: Record<'style' | 'color' | 'activity', string> = {
    style: 'border-primary/30 bg-primary/5',
    color: 'border-accent/30 bg-accent/10',
    activity: 'border-secondary/30 bg-secondary/10'
  };
  return <Card className={`bg-white/70 backdrop-blur-md overflow-hidden ${className}`}>
      <div className="relative h-48">
        <img src={apartment.images[currentImageIndex] || '/placeholder-property.jpg'} alt={`${apartment.title} - Image ${currentImageIndex + 1}`} className="w-full h-full object-cover cursor-pointer hover:scale-105 transition-transform duration-200" onClick={() => setIsImageModalOpen(true)} />

        {/* Vibe Ranking Overlay */}
        {vibeScore && !hideVibeScore && (
          <div className="absolute top-3 left-3 z-10">
            <VibeScore score={vibeScore} apartment={apartment} size="sm" isAnonymous={isAnonymous} />
          </div>
        )}

        {/* Share Button Overlay */}
        <div className={`absolute top-3 z-10 ${hasDeleteButton ? 'right-12' : 'right-3'}`}>
          <Button size="sm" variant="secondary" aria-label="Share property" className="bg-white/90 backdrop-blur-sm hover:bg-white shadow-md w-8 h-8 p-0" onClick={handleShare}>
            <Share2 className="w-4 h-4" aria-hidden="true" />
          </Button>
        </div>

      </div>
      
      <div className="p-4 sm:p-6">
        <div className="mb-2">
          {/* Mobile: Title above vibe score */}
          <div className="block sm:hidden mb-3">
            <h2 className="text-xl text-gray-900 font-serif font-normal">
              <span className={showFullTitle ? '' : 'line-clamp-2'}>{displayTitle}</span>
            </h2>
          </div>
          
          <div className="flex items-start justify-between mb-2">
            {/* Desktop: Title */}
            <h2 className="hidden sm:block text-xl text-gray-900 flex-1 mr-3 font-serif font-normal">
              <span className={showFullTitle ? '' : 'line-clamp-2'}>{displayTitle}</span>
            </h2>
          </div>
        </div>
        
        <div className="flex flex-col text-sm mb-3 gap-2">
          <div className="flex items-center text-muted-foreground">
            <MapPin className="w-3 h-3 mr-1 flex-shrink-0" />
            <button
              className="line-clamp-1 text-left hover:text-primary hover:underline transition-colors cursor-pointer flex items-center gap-1"
              onClick={handleLocationClick}
              disabled={isGeocoding}
            >
              {displayLocation}
              {isGeocoding && <Loader2 className="w-3 h-3 animate-spin" />}
            </button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className="bg-primary text-primary-foreground font-semibold">
              {formatPrice(apartment.price)}/mo
            </Badge>
            {apartment.rooms && <Badge variant="outline" className="text-xs">
                {apartment.rooms}
              </Badge>}
            {apartment.size && <Badge variant="outline" className="text-xs">
                {/m²|m2|sqm|sqft/i.test(apartment.size) ? apartment.size : `${apartment.size} m²`}
              </Badge>}
          </div>
        </div>


        {/* Amenities Section */}
        {apartment.amenities && apartment.amenities.length > 0 && <div className="mb-3 pb-3 border-b border-border">
            <PropertyAmenities amenities={apartment.amenities} compact />
          </div>}

        {apartment.description && !descriptionDuplicatesTitle && <div className="mb-4">
            <div className={`text-gray-700 text-sm leading-relaxed ${expandedDescription ? '' : 'line-clamp-3'}`}>
              {apartment.description}
            </div>
            {apartment.description && apartment.description.length > 150 && <Button variant="ghost" size="sm" className="p-0 h-auto text-orange-600 hover:text-orange-700 mt-1" onClick={() => setExpandedDescription(!expandedDescription)}>
                {expandedDescription ? <>
                    <ChevronUp className="w-3 h-3 mr-1" />
                    Read less
                  </> : <>
                    <ChevronDown className="w-3 h-3 mr-1" />
                    Read more
                  </>}
              </Button>}
          </div>}

        {/* Additional Images with AI-Generated Highlights */}
        {apartment.images && apartment.images.length > 1 && (
          <div className="mb-4 space-y-3">
            <div className="flex items-center gap-1.5 mb-2">
              <p className="text-xs font-semibold text-foreground">More Photos</p>
            </div>
            <div className="space-y-3">
              {apartment.images.slice(1).map((image, sliceIndex) => {
                const imageAnalyses = apartment.vibe_analysis?.image_analyses || [];

                // sliceIndex 0 = original array position 1 (2nd image)
                // arrayIndex in original array is sliceIndex + 1
                const arrayIndex = sliceIndex + 1;
                // image_index from DB is 0-based (0 for first image, 1 for second, etc.)
                // So for the 2nd image (arrayIndex=1), we look for image_index=1
                const analysisForImage = imageAnalyses.find((a: any) => {
                  const rawIdx = Number(a?.image_index);
                  if (!Number.isFinite(rawIdx)) return false;
                  return rawIdx === arrayIndex;
                });

                // Only show highlights that came from per-image AI analysis, never generic property-level highlights
                const imageHighlight = analysisForImage?.image_highlight || analysisForImage?.highlight || undefined;

                return (
                  <div key={sliceIndex} className="space-y-2">
                    <div className="relative">
                      <img
                        src={image}
                        alt={`${apartment.title} - Image ${arrayIndex + 1}`}
                        className="w-full h-32 object-cover rounded-md cursor-pointer hover:scale-105 transition-transform duration-200"
                        onClick={() => {
                          setCurrentImageIndex(arrayIndex);
                          setIsImageModalOpen(true);
                        }}
                      />
                    </div>
                    {imageHighlight && (
                      <div className="flex items-start gap-1.5 px-1">
                        <Sparkles className="w-3 h-3 text-primary flex-shrink-0 mt-0.5" />
                        <span className="text-xs text-foreground/90 leading-relaxed">{imageHighlight}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}


        {showRealtorInfo && <div className="flex items-center justify-between pt-3 border-t border-gray-200">
            <div className="flex items-center space-x-2">
              {apartment.realtor.avatar && apartment.realtor.avatar.trim() ? <img src={apartment.realtor.avatar} alt={apartment.realtor.name || 'Realtor'} className="w-8 h-8 rounded-full object-cover" /> : <div className="w-8 h-8 bg-gradient-to-r from-blue-400 to-purple-500 rounded-full flex items-center justify-center">
                  <User className="w-4 h-4 text-white" />
                </div>}
              <div>
                <div className="flex items-center gap-1">
                  <span className="text-sm font-medium text-gray-900">{apartment.realtor.name || 'Realtor'}</span>
                </div>
                {apartment.property_source_provider_name && <div className="text-xs text-muted-foreground mt-0.5">
                    {isOwnProperty ? <>
                        Provider: {apartment.property_source_provider_name}
                        {apartment.property_source_provider_phone && <span className="ml-1">• {apartment.property_source_provider_phone}</span>}
                      </> : `Listed on behalf of ${apartment.property_source_provider_name}`}
                  </div>}
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              {apartment.property_source_link && (() => {
            const sourceInfo = getPropertySourceLogo(apartment.property_source_link);
            const logoSize = sourceInfo.name === 'Batdongsan.com.vn' ? 'w-14 h-14' : sourceInfo.name === 'Airbnb' ? 'w-11 h-11' : 'w-10 h-10';
            return <a href={apartment.property_source_link} target="_blank" rel="noopener noreferrer" title={`View on ${sourceInfo.name}`} className="flex items-center justify-center h-9 rounded-md hover:opacity-80 transition-opacity">
                    <img src={sourceInfo.logo} alt={sourceInfo.name} className={`${logoSize} object-contain`} />
                    
                  </a>;
          })()}
              {showContactButton && onContact && <Button size="sm" className="bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white shadow-md" onClick={onContact}>
                  Contact
                </Button>}
            </div>
          </div>}
      </div>

      {/* Full-size image modal */}
      <PropertyImageModal apartment={apartment} isOpen={isImageModalOpen} onClose={() => setIsImageModalOpen(false)} initialImageIndex={currentImageIndex} />

      {/* Map modal */}
      {canShowMap && (
        <MapViewModal
          isOpen={isMapOpen}
          onClose={() => setIsMapOpen(false)}
          latitude={mapLat}
          longitude={mapLng}
          title={apartment.title}
          location={apartment.location}
        />
      )}
    </Card>;
};