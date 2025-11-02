import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MapPin, User, ChevronDown, ChevronUp, Sparkles, ExternalLink, Share2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
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
}
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
  showRealtorInfo = true
}: PropertyCardProps) => {
  // Use provided image index from SwipeInterface or maintain own state
  const externalImageIndex = (apartment as any)._currentImageIndex;
  const [currentImageIndex, setCurrentImageIndex] = useState(externalImageIndex || 0);
  const [expandedDescription, setExpandedDescription] = useState(false);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const {
    formatPrice
  } = useCurrency();

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
        description: "Property link has been copied to your clipboard.",
      });
    } catch (error) {
      console.error('Failed to copy link:', error);
      toast({
        title: "Failed to copy",
        description: "Please try again.",
        variant: "destructive",
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
        <img
          src={apartment.images[currentImageIndex] || '/placeholder-property.jpg'}
          alt={`${apartment.title} - Image ${currentImageIndex + 1}`}
          className="w-full h-full object-cover cursor-pointer hover:scale-105 transition-transform duration-200"
          onClick={() => setIsImageModalOpen(true)}
        />

        {/* Vibe Ranking Overlay */}
        {vibeScore && !hideVibeScore && (
          <div className="absolute top-3 left-3 z-10">
            <VibeScore score={vibeScore} size="sm" isAnonymous={isAnonymous} />
          </div>
        )}

        {/* Share Button Overlay */}
        <div className={`absolute top-3 z-10 ${hasDeleteButton ? 'right-12' : 'right-3'}`}>
          <Button
            size="sm"
            variant="secondary"
            className="bg-white/90 backdrop-blur-sm hover:bg-white shadow-md w-8 h-8 p-0"
            onClick={handleShare}
          >
            <Share2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
      
      <div className="p-4 sm:p-6">
        <div className="mb-2">
          {/* Mobile: Title above vibe score */}
          <div className="block sm:hidden mb-3">
            <h2 className={`text-xl font-semibold text-gray-900 ${showFullTitle ? '' : 'line-clamp-2'}`}>{apartment.title}</h2>
          </div>
          
          <div className="flex items-start justify-between mb-2">
            {/* Desktop: Title */}
            <h2 className={`hidden sm:block text-xl font-semibold text-gray-900 flex-1 mr-3 ${showFullTitle ? '' : 'line-clamp-2'}`}>{apartment.title}</h2>
          </div>
        </div>
        
        <div className="flex flex-col text-sm mb-3 gap-2">
          <div className="flex items-center text-gray-600">
            <MapPin className="w-3 h-3 mr-1 flex-shrink-0" />
            <span className="line-clamp-1">{apartment.location}</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="bg-primary text-primary-foreground font-semibold">
              {formatPrice(apartment.price)}/mo
            </Badge>
            {apartment.size && <Badge variant="outline" className="text-xs">
                {apartment.size}
              </Badge>}
          </div>
        </div>

        {/* Amenities Section */}
        {apartment.vibe_analysis?.amenities && apartment.vibe_analysis.amenities.length > 0 && (
          <div className="mb-3 pb-3 border-b border-border">
            <PropertyAmenities amenities={apartment.vibe_analysis.amenities} compact />
          </div>
        )}

        {apartment.description && <div className="mb-4">
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

        {/* Additional Images with Highlights */}
        {apartment.images.length > 1 && <div className="mb-4 space-y-3">
            <p className="text-xs font-medium text-muted-foreground">More Photos</p>
            <div className="space-y-4">
              {apartment.images.slice(1).map((image, index) => {
          const imageAnalyses = apartment.vibe_analysis?.image_analyses || [];
          const analysisForImage = imageAnalyses.find(a => a.image_index === index + 1);

          // Get full highlight for this image
          const imageHighlight = analysisForImage?.image_highlight || apartment.highlights?.[index + 1] || apartment.highlights?.[index] || `Beautiful ${apartment.title.toLowerCase()} feature`;
          return <div key={index} className="space-y-2">
                    <div className="flex items-center gap-1 text-xs text-primary">
                      <Sparkles className="w-2.5 h-2.5" />
                      <span className="font-medium">{imageHighlight}</span>
                    </div>
                    <div className="relative h-48">
                      <img src={image} alt={`${apartment.title} - Image ${index + 2}`} className="w-full h-full object-cover rounded-md cursor-pointer hover:scale-105 transition-transform duration-200" onClick={() => {
                setCurrentImageIndex(index + 1);
                setIsImageModalOpen(true);
              }} />
                    </div>
                  </div>;
        })}
            </div>
          </div>}


        {showRealtorInfo && (
        <div className="flex items-center justify-between pt-3 border-t border-gray-200">
            <div className="flex items-center space-x-2">
              {apartment.realtor.avatar && apartment.realtor.avatar.trim() ? (
                <img 
                  src={apartment.realtor.avatar} 
                  alt={apartment.realtor.name || 'Realtor'} 
                  className="w-8 h-8 rounded-full object-cover"
                />
              ) : (
                <div 
                  className="w-8 h-8 bg-gradient-to-r from-blue-400 to-purple-500 rounded-full flex items-center justify-center"
                >
                  <User className="w-4 h-4 text-white" />
                </div>
              )}
              <div>
                <div className="flex items-center gap-1">
                  <span className="text-sm font-medium text-gray-900">{apartment.realtor.name || 'Realtor'}</span>
                </div>
                
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              {apartment.property_source_link && (() => {
              const sourceInfo = getPropertySourceLogo(apartment.property_source_link);
              const logoSize = sourceInfo.name === 'Batdongsan.com.vn' ? 'w-14 h-14' : 
                              sourceInfo.name === 'Airbnb' ? 'w-11 h-11' : 'w-10 h-10';
              return <a href={apartment.property_source_link} target="_blank" rel="noopener noreferrer" title={`View on ${sourceInfo.name}`} className="flex items-center justify-center h-9 rounded-md hover:opacity-80 transition-opacity">
                    <img src={sourceInfo.logo} alt={sourceInfo.name} className={`${logoSize} object-contain`} />
                    
                  </a>;
            })()}
              {showContactButton && onContact && <Button size="sm" className="bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white shadow-md" onClick={onContact}>
                  Contact
                </Button>}
            </div>
          </div>
        )}
      </div>

      {/* Full-size image modal */}
      <PropertyImageModal apartment={apartment} isOpen={isImageModalOpen} onClose={() => setIsImageModalOpen(false)} initialImageIndex={currentImageIndex} />
    </Card>;
};