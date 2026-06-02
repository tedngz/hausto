import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MapPin } from 'lucide-react';
import { LOCATION_DESCRIPTIONS } from '@/data/locationDescriptions';

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
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setMapReady(false);
      return;
    }
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

      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }

      const map = L.map(mapRef.current, {
        center: [latitude, longitude],
        zoom: 15,
        zoomControl: false,
        scrollWheelZoom: false,
        attributionControl: true,
      });
      mapInstanceRef.current = map;

      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> · <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20,
      }).addTo(map);

      L.control.zoom({ position: 'bottomright' }).addTo(map);

      const pinIcon = L.divIcon({
        className: 'hausto-pin',
        html: `
          <span style="position:relative;display:block;width:32px;height:32px;">
            <span style="position:absolute;inset:0;border-radius:9999px;background:rgba(13,79,74,0.18);animation:haustoPulse 2.4s ease-out infinite;"></span>
            <span style="position:absolute;top:50%;left:50%;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:9999px;background:#0D4F4A;box-shadow:0 0 0 3px #fff, 0 4px 10px rgba(13,79,74,0.35);"></span>
          </span>
          <style>@keyframes haustoPulse{0%{transform:scale(0.6);opacity:0.7}100%{transform:scale(1.6);opacity:0}}</style>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      L.marker([latitude, longitude], { icon: pinIcon }).addTo(map);

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
          ref={mapRef}
          className="w-full rounded-b-lg overflow-hidden ring-1 ring-border/40"
          style={{ height: '380px', minHeight: '380px', position: 'relative', zIndex: 1, background: '#f5f3ee' }}
        />
      </DialogContent>
    </Dialog>
  );
};
