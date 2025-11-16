import { useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { Apartment } from '@/types';

interface PropertyImageModalProps {
  apartment: Apartment;
  isOpen: boolean;
  onClose: () => void;
  initialImageIndex?: number;
}

export const PropertyImageModal = ({ 
  apartment, 
  isOpen, 
  onClose, 
  initialImageIndex = 0 
}: PropertyImageModalProps) => {
  const [currentImageIndex, setCurrentImageIndex] = useState(initialImageIndex);

  const nextImage = () => {
    setCurrentImageIndex((prev) => (prev + 1) % apartment.images.length);
  };

  const prevImage = () => {
    setCurrentImageIndex((prev) => (prev - 1 + apartment.images.length) % apartment.images.length);
  };

  // Get image-specific highlight
  const imageAnalyses = apartment.vibe_analysis?.image_analyses || [];
  // image_index from DB is 1-based (1 for first image, 2 for second, etc.)
  // currentImageIndex is 0-based, so add 1 to match DB format
  const dbImageIndex = currentImageIndex + 1;
  const analysisForImage = imageAnalyses.find((a: any) => {
    const rawIdx = Number(a?.image_index);
    if (!Number.isFinite(rawIdx)) return false;
    return rawIdx === dbImageIndex;
  });
  const selectedHighlight = analysisForImage?.image_highlight || null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-[95vw] sm:max-w-6xl h-[85vh] sm:h-[90vh] p-2 sm:p-4 overflow-hidden bg-background/95 backdrop-blur-sm border shadow-xl">
        <div className="relative w-full h-full bg-transparent">

          {/* Main image */}
          <div className="relative w-full h-full flex items-center justify-center overflow-hidden rounded-lg">
            <img
              src={apartment.images[currentImageIndex] || '/placeholder-property.jpg'}
              alt={apartment.title}
              className="w-full h-full object-contain max-w-full max-h-full"
              style={{ 
                maxHeight: 'calc(85vh - 4rem)',
                maxWidth: 'calc(95vw - 2rem)'
              }}
            />

            {/* AI Highlights overlay */}
            {selectedHighlight && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 w-[95%] sm:max-w-md md:max-w-lg flex justify-center">
                <Badge className="bg-orange-500/90 text-white border-orange-400 shadow-lg flex items-center justify-center gap-1 sm:gap-1.5 text-center text-[10px] sm:text-xs px-3 py-2 leading-snug max-w-full">
                  <Sparkles className="w-3 h-3 flex-shrink-0" />
                  <span className="break-words line-clamp-2">{selectedHighlight}</span>
                </Badge>
              </div>
            )}

            {/* Navigation buttons */}
            {apartment.images.length > 1 && (
              <>
                <Button
                  size="lg"
                  variant="ghost"
                  className="absolute left-4 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full w-12 h-12 p-0"
                  onClick={prevImage}
                >
                  <ChevronLeft className="w-6 h-6" />
                </Button>
                <Button
                  size="lg"
                  variant="ghost"
                  className="absolute right-4 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full w-12 h-12 p-0"
                  onClick={nextImage}
                >
                  <ChevronRight className="w-6 h-6" />
                </Button>
              </>
            )}
          </div>

          {/* Image counter and dots */}
          {apartment.images.length > 1 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
              <div className="bg-black/60 backdrop-blur-sm rounded-full px-4 py-2 flex items-center space-x-3">
                <span className="text-white text-sm">
                  {currentImageIndex + 1} / {apartment.images.length}
                </span>
                <div className="flex space-x-1">
                  {apartment.images.map((_, index) => (
                    <button
                      key={index}
                      className={`w-2 h-2 rounded-full transition-colors ${
                        index === currentImageIndex ? 'bg-white' : 'bg-white/40'
                      }`}
                      onClick={() => setCurrentImageIndex(index)}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};