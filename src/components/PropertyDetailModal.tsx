
import React, { useState } from 'react';
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

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[95vh] overflow-y-auto p-0">
        <div className="p-4 space-y-4">
          <h2 className="text-xl font-bold text-gray-900 text-center">Property Details</h2>
          
          <PropertyCard
            apartment={apartment}
            userPreferences={userPreferences}
            showFullTitle={true}
            showFullDescription={true}
            showAllHighlights={true}
            showContactButton={false}
            showViewProfileButton={false}
            className="shadow-none border-0"
          />

          {/* Action Buttons */}
          {(onLike || onDislike) && (
            <div className="flex justify-center space-x-4 pt-4 mt-4 border-t">
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
