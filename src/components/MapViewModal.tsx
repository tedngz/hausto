import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MapPin } from 'lucide-react';

interface MapViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  latitude: number;
  longitude: number;
  title: string;
  location: string;
}

export const MapViewModal = ({ isOpen, onClose, latitude, longitude, title, location }: MapViewModalProps) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setMapReady(false);
      return;
    }

    // Delay to let the dialog animate open
    const readyTimer = setTimeout(() => setMapReady(true), 350);
    return () => clearTimeout(readyTimer);
  }, [isOpen]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;

    let cancelled = false;

    const initMap = async () => {
      const L = await import('leaflet');
      await import('leaflet/dist/leaflet.css');

      if (cancelled || !mapRef.current) return;

      // Fix default marker icon
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
        iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
      });

      // Clean up previous instance
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }

      const map = L.map(mapRef.current, {
        center: [latitude, longitude],
        zoom: 15,
        zoomControl: true,
      });
      mapInstanceRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(map);

      L.marker([latitude, longitude])
        .addTo(map)
        .bindPopup(`<strong>${title}</strong><br/>${location}`)
        .openPopup();

      // Force multiple invalidateSize calls to handle dialog animation
      for (const delay of [0, 100, 250, 500, 1000]) {
        setTimeout(() => {
          if (!cancelled && mapInstanceRef.current) {
            mapInstanceRef.current.invalidateSize();
          }
        }, delay);
      }
    };

    initMap();

    return () => {
      cancelled = true;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [mapReady, latitude, longitude, title, location]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[600px] p-0 overflow-hidden" style={{ zIndex: 60 }}>
        <DialogHeader className="p-4 pb-2">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <MapPin className="w-5 h-5 text-primary" />
            {title}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{location}</p>
        </DialogHeader>
        <div
          ref={mapRef}
          className="w-full"
          style={{ height: '400px', minHeight: '400px', position: 'relative', zIndex: 1 }}
        />
      </DialogContent>
    </Dialog>
  );
};
