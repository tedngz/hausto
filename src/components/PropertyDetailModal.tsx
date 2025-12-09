import React from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Heart, X } from 'lucide-react';
import { Apartment, UserPreferences } from '@/types';
import { PropertyCard } from '@/components/PropertyCard';
import { VibeScore } from '@/components/VibeScore';
import { calculateVibeScore } from '@/utils/vibeScoring';
interface PropertyDetailModalProps {
  apartment: Apartment | null;
  userPreferences?: UserPreferences;
  isOpen: boolean;
  onClose: () => void;
  onLike?: (apartment: Apartment) => void;
  onDislike?: (apartment: Apartment) => void;
  isAnonymous?: boolean;
}
export const PropertyDetailModal = ({
  apartment,
  userPreferences,
  isOpen,
  onClose,
  onLike,
  onDislike,
  isAnonymous = false
}: PropertyDetailModalProps) => {
  if (!apartment) return null;
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
  const vibeScore = userPreferences && !isAnonymous ? calculateVibeScore(apartment, userPreferences) : {
    overall: 75,
    breakdown: {
      style: 75,
      color: 75,
      activities: 75,
      price: 75,
      location: 75
    }
  }; // Default "Good vibe" for anonymous users

  return <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md w-[95vw] max-h-[90vh] sm:max-h-[95vh] overflow-y-auto p-0 gap-0">
        <div className="p-3 sm:p-4 relative">
          {/* Vibe Score Overlay */}
          <div className="absolute top-6 left-6 z-10">
            <VibeScore score={vibeScore} apartment={apartment} size="sm" isAnonymous={isAnonymous} />
          </div>
          
          <PropertyCard apartment={apartment} userPreferences={userPreferences} showFullTitle={true} showFullDescription={true} showAllHighlights={true} showContactButton={false} className="shadow-none border-0 bg-transparent" isAnonymous={isAnonymous} hideVibeScore={true} />

          {/* Action Buttons */}
          {(onLike || onDislike) && <div className="flex justify-center space-x-4 pt-4 mt-4 border-t py-0">
              {onDislike && <Button size="lg" variant="outline" className="w-16 h-16 rounded-full border-red-300 text-red-500 hover:bg-red-50 hover:border-red-400" onClick={handleDislike}>
                  <X className="w-8 h-8" />
                </Button>}
              {onLike && <Button size="lg" onClick={handleLike} className="w-16 h-16 rounded-full bg-gradient-to-r from-orange-400 to-orange-500 hover:from-orange-500 hover:to-orange-600 text-white">
                  <Heart className="w-8 h-8" />
                </Button>}
            </div>}
        </div>
      </DialogContent>
    </Dialog>;
};