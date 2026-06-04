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
      <DialogContent className="sm:max-w-[600px] p-0 overflow-hidden" style={{ zIndex: 60 }}>
        <DialogHeader className="p-4 pb-0">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <MapPin className="w-5 h-5 text-primary" />
            {location}
          </DialogTitle>
          {locationDesc && (
            <p className="text-sm text-muted-foreground leading-relaxed">{locationDesc}</p>
          )}
        </DialogHeader>
        <div
          className="w-full rounded-b-lg overflow-hidden ring-1 ring-border/40"
          style={{ height: '420px', minHeight: '420px', position: 'relative', zIndex: 1, background: '#f5f3ee' }}
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
