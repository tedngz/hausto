import React from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Heart, X } from 'lucide-react';
import { Apartment, UserPreferences } from '@/types';
import { PropertyCard } from '@/components/PropertyCard';
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
  return <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[95vh] overflow-y-auto p-0 m-4">
        <div className="p-4 px-[17px] mx-0">
          <PropertyCard apartment={apartment} userPreferences={userPreferences} showFullTitle={true} showFullDescription={true} showAllHighlights={true} showContactButton={false} showViewProfileButton={false} className="shadow-none border-0 bg-transparent" />

          {/* Action Buttons */}
          {(onLike || onDislike) && <div className="flex justify-center space-x-4 pt-4 mt-4 border-t">
              {onDislike && <Button size="lg" variant="outline" className="w-16 h-16 rounded-full border-red-300 text-red-500 hover:bg-red-50 hover:border-red-400" onClick={handleDislike}>
                  <X className="w-8 h-8" />
                </Button>}
              {onLike && <Button size="lg" className="w-16 h-16 rounded-full bg-gradient-to-r from-green-400 to-green-500 hover:from-green-500 hover:to-green-600 text-white" onClick={handleLike}>
                  <Heart className="w-8 h-8" />
                </Button>}
            </div>}
        </div>
      </DialogContent>
    </Dialog>;
};