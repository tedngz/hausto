
import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { MapPin, User, Heart, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Apartment, UserPreferences } from '@/pages/Index';
import { calculateVibeScore } from '@/utils/vibeScoring';
import { VibeScore } from '@/components/VibeScore';
import { useCurrency } from '@/contexts/CurrencyContext';

interface PropertyDetailModalProps {
  apartment: Apartment | null;
  userPreferences?: UserPreferences;
  isOpen: boolean;
  onClose: () => void;
  onLike?: (apartment: Apartment) => void;
  onDislike?: (apartment: Apartment) => void;
}

export const PropertyDetailModal = ({ 
  apartment, 
  userPreferences, 
  isOpen, 
  onClose, 
  onLike, 
  onDislike 
}: PropertyDetailModalProps) => {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const { formatPrice } = useCurrency();

  if (!apartment) return null;

  const vibeScore = userPreferences ? calculateVibeScore(apartment, userPreferences) : null;

  const nextImage = () => {
    setCurrentImageIndex((prev) => (prev + 1) % apartment.images.length);
  };

  const prevImage = () => {
    setCurrentImageIndex((prev) => 
      prev === 0 ? apartment.images.length - 1 : prev - 1
    );
  };

  const handleLike = () => {
    if (onLike) {
      onLike(apartment);
    }
    onClose();
  };

  const handleDislike = () => {
    if (onDislike) {
      onDislike(apartment);
    }
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">{apartment.title}</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Representative Property Image */}
          <div className="relative">
            <img
              src={apartment.images[0] || '/placeholder-property.jpg'}
              alt={apartment.title}
              className="w-full h-64 object-cover rounded-lg"
            />

            <div className="absolute top-3 right-3">
              <Badge className="bg-white/90 text-gray-800 font-semibold">
                {formatPrice(apartment.price)}/mo
              </Badge>
            </div>
          </div>

          {/* Property Details */}
          <div className="space-y-3">
            <div className="flex items-center text-gray-600 text-sm">
              <MapPin className="w-4 h-4 mr-2" />
              {apartment.location}
            </div>

            <div className="flex items-center space-x-4">
              <Badge variant="secondary" className="bg-gradient-to-r from-orange-100 to-red-100 text-orange-800">
                {apartment.vibe}
              </Badge>
              <Badge variant="outline">{apartment.size}</Badge>
            </div>

            {vibeScore && (
              <VibeScore score={vibeScore} showBreakdown={true} size="sm" />
            )}

            <p className="text-gray-700 text-sm leading-relaxed">
              {apartment.description}
            </p>

            {/* Additional Images with Highlights */}
            {apartment.images.length > 1 && (
              <div className="space-y-4">
                <h4 className="font-medium text-gray-900">More Photos</h4>
                <div className="space-y-6">
                  {apartment.images.slice(1).map((image, index) => {
                    const highlights = apartment.vibe_analysis?.generated_content?.highlights || [];
                    const associatedHighlight = highlights[index % highlights.length];
                    
                    return (
                      <div key={index} className="space-y-3">
                        {associatedHighlight && (
                          <span className="text-sm text-primary">
                            {associatedHighlight}
                          </span>
                        )}
                        <div className="relative">
                          <img
                            src={image}
                            alt={`${apartment.title} - Image ${index + 2}`}
                            className="w-full h-64 object-cover rounded-lg cursor-pointer hover:scale-105 transition-transform duration-200"
                            onClick={() => setCurrentImageIndex(index + 1)}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <h4 className="font-medium text-gray-900">Key Features</h4>
              <div className="flex flex-wrap gap-2">
                {apartment.highlights.map((highlight, index) => (
                  <Badge key={index} variant="outline" className="text-xs">
                    {highlight}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="bg-gray-50 p-3 rounded-lg">
              <p className="text-sm font-medium">Realtor Information</p>
              <p className="text-xs text-gray-600">Contact details are shared after matching</p>
            </div>
          </div>

          {/* Action Buttons */}
          {(onLike || onDislike) && (
            <div className="flex justify-center space-x-4 pt-4 border-t">
              {onDislike && (
                <Button variant="destructive" size="lg" className="w-24" onClick={handleDislike}>
                  <X className="w-5 h-5 mr-2" />
                  Pass
                </Button>
              )}
              {onLike && (
                <Button 
                  className="bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white shadow-md w-24" 
                  size="lg" 
                  onClick={handleLike}
                >
                  <Heart className="w-5 h-5 mr-2" />
                  Like
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
