import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { MapPin, X } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix default marker icon
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

interface MapLocationPickerProps {
  latitude: number | null;
  longitude: number | null;
  onLocationChange: (lat: number | null, lng: number | null) => void;
}

// Default center: Ho Chi Minh City
const DEFAULT_CENTER: [number, number] = [10.7769, 106.7009];

export const MapLocationPicker = ({ latitude, longitude, onLocationChange }: MapLocationPickerProps) => {
  const [isMapOpen, setIsMapOpen] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    if (!isMapOpen || !mapRef.current) return;

    const timer = setTimeout(() => {
      if (!mapRef.current) return;

      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }

      const center: [number, number] = latitude && longitude ? [latitude, longitude] : DEFAULT_CENTER;
      const map = L.map(mapRef.current).setView(center, latitude ? 15 : 12);
      mapInstanceRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }).addTo(map);

      // Add existing marker
      if (latitude && longitude) {
        markerRef.current = L.marker([latitude, longitude]).addTo(map);
      }

      // Click to place marker
      map.on('click', (e: L.LeafletMouseEvent) => {
        const { lat, lng } = e.latlng;
        if (markerRef.current) {
          markerRef.current.setLatLng([lat, lng]);
        } else {
          markerRef.current = L.marker([lat, lng]).addTo(map);
        }
        onLocationChange(lat, lng);
      });

      setTimeout(() => map.invalidateSize(), 100);
    }, 100);

    return () => {
      clearTimeout(timer);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markerRef.current = null;
      }
    };
  }, [isMapOpen]); // Only re-init when map opens

  const clearLocation = () => {
    onLocationChange(null, null);
    if (markerRef.current && mapInstanceRef.current) {
      mapInstanceRef.current.removeLayer(markerRef.current);
      markerRef.current = null;
    }
  };

  return (
    <div className="space-y-2">
      <Label className="text-sm">Pin Location on Map (Optional)</Label>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setIsMapOpen(!isMapOpen)}
          className="gap-1.5"
        >
          <MapPin className="w-4 h-4" />
          {isMapOpen ? 'Hide Map' : latitude ? 'Edit Pin' : 'Set Pin'}
        </Button>
        {latitude && longitude && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>{latitude.toFixed(5)}, {longitude.toFixed(5)}</span>
            <Button type="button" variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={clearLocation}>
              <X className="w-3 h-3" />
            </Button>
          </div>
        )}
      </div>
      {isMapOpen && (
        <div className="border rounded-lg overflow-hidden">
          <div ref={mapRef} className="w-full h-[250px]" />
          <p className="text-xs text-muted-foreground px-2 py-1 bg-muted">Click on the map to set the property location</p>
        </div>
      )}
    </div>
  );
};
