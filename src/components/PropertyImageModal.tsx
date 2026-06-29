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
  // image_index from DB is 0-based (0 for first image, 1 for second, etc.)
  // currentImageIndex is also 0-based, so match directly
  const analysisForImage = imageAnalyses.find((a: any) => {
    const rawIdx = Number(a?.image_index);
    if (!Number.isFinite(rawIdx)) return false;
    return rawIdx === currentImageIndex;
  });
  const selectedHighlight = analysisForImage?.image_highlight || analysisForImage?.highlight || null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-none w-screen h-[100dvh] max-h-none p-0 m-0 rounded-none bg-black/95 backdrop-blur-xl border-none flex flex-col justify-between overflow-hidden gap-0">
        
        {/* Top Section - Highlight Badge */}
        <div className="w-full flex-shrink-0 p-4 min-h-[60px] sm:min-h-[80px] flex items-start justify-center relative z-20">
          {selectedHighlight && (
            <Badge className="bg-orange-500/90 text-white border-orange-400 shadow-lg flex items-center justify-center gap-1.5 text-center text-xs sm:text-sm px-4 py-2 leading-snug max-w-[80%] mx-auto mt-2">
              <Sparkles className="w-4 h-4 flex-shrink-0" />
              <span className="break-words line-clamp-2">{selectedHighlight}</span>
            </Badge>
          )}
        </div>

        {/* Middle Section - Main Image and Desktop Arrows */}
        <div className="flex-1 w-full relative flex items-center justify-center overflow-hidden px-0 sm:px-16 z-10">
          
          {/* Desktop Prev Button */}
          {apartment.images.length > 1 && (
            <Button
              variant="ghost"
              className="hidden sm:flex absolute left-4 top-1/2 -translate-y-1/2 bg-white/10 hover:bg-white/20 text-white rounded-full w-12 h-12 p-0 z-20"
              onClick={prevImage}
            >
              <ChevronLeft className="w-8 h-8" />
            </Button>
          )}

          {/* The Image (no overlap!) */}
          <div className="w-full h-full flex items-center justify-center">
            <img
              src={apartment.images[currentImageIndex] || '/placeholder-property.jpg'}
              alt={apartment.title}
              className="w-full h-full object-contain max-w-full max-h-full drop-shadow-2xl"
            />
          </div>

          {/* Desktop Next Button */}
          {apartment.images.length > 1 && (
            <Button
              variant="ghost"
              className="hidden sm:flex absolute right-4 top-1/2 -translate-y-1/2 bg-white/10 hover:bg-white/20 text-white rounded-full w-12 h-12 p-0 z-20"
              onClick={nextImage}
            >
              <ChevronRight className="w-8 h-8" />
            </Button>
          )}
        </div>

        {/* Bottom Section - Counter and Mobile Navigation */}
        <div className="w-full flex-shrink-0 p-4 sm:p-6 min-h-[80px] flex items-center justify-center z-20">
          {apartment.images.length > 1 && (
            <div className="flex items-center gap-4">
              
              {/* Mobile Prev Button */}
              <Button
                variant="ghost"
                className="sm:hidden bg-white/10 hover:bg-white/20 text-white rounded-full w-12 h-12 p-0"
                onClick={prevImage}
              >
                <ChevronLeft className="w-6 h-6" />
              </Button>

              {/* Counter and Dots */}
              <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-full px-5 py-2.5 flex items-center space-x-3 shadow-lg">
                <span className="text-white text-sm font-medium tabular-nums">
                  {currentImageIndex + 1} / {apartment.images.length}
                </span>
                <div className="space-x-1.5 hidden sm:flex border-l border-white/30 pl-3">
                  {apartment.images.map((_, index) => (
                    <button
                      key={index}
                      className={`w-2 h-2 rounded-full transition-all duration-300 ${
                        index === currentImageIndex ? 'bg-white scale-125' : 'bg-white/40 hover:bg-white/60'
                      }`}
                      onClick={() => setCurrentImageIndex(index)}
                    />
                  ))}
                </div>
              </div>

              {/* Mobile Next Button */}
              <Button
                variant="ghost"
                className="sm:hidden bg-white/10 hover:bg-white/20 text-white rounded-full w-12 h-12 p-0"
                onClick={nextImage}
              >
                <ChevronRight className="w-6 h-6" />
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};