import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MapPin } from 'lucide-react';
import { LOCATION_DESCRIPTIONS } from '@/data/locationDescriptions';
import { useComplexes } from '@/hooks/useComplexes';
import { ComplexMapCanvas } from '@/components/ComplexMapCanvas';

function getLocationDescription(location: string): string | null {
  const lower = location.toLowerCase();
  for (const [key, desc] of Object.entries(LOCATION_DESCRIPTIONS)) {
    if (lower.includes(key)) return desc;
  }
  return null;
}

interface MapViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  latitude: number;
  longitude: number;
  title: string;
  location: string;
}

export const MapViewModal = ({ isOpen, onClose, latitude, longitude, title, location }: MapViewModalProps) => {
  const { data: complexes } = useComplexes();
  const locationDesc = getLocationDescription(location);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[95vw] sm:max-w-[600px] p-0 overflow-hidden rounded-2xl" style={{ zIndex: 60 }}>
        <DialogHeader className="p-4 sm:p-5 pb-2 text-left">
          <DialogTitle className="flex items-start sm:items-center gap-2 text-base sm:text-lg pr-6">
            <MapPin className="w-5 h-5 text-primary flex-shrink-0 mt-0.5 sm:mt-0" />
            <span className="leading-tight">{location}</span>
          </DialogTitle>
          {locationDesc && (
            <p className="text-sm text-muted-foreground leading-relaxed pt-1 pr-4">{locationDesc}</p>
          )}
        </DialogHeader>
        <div
          className="w-full rounded-b-2xl overflow-hidden ring-1 ring-border/40"
          style={{ height: '50vh', minHeight: '350px', maxHeight: '500px', position: 'relative', zIndex: 1, background: '#f5f3ee' }}
        >
          {isOpen && (
            <ComplexMapCanvas
              complexes={complexes ?? []}
              focusLatLng={{ lat: latitude, lng: longitude, label: title }}
              hideChrome
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
