import { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { MapPin, X, Loader2 } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getBasemap } from '@/lib/basemap';

// Fix default marker icon
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const basemap = getBasemap();

interface MapLocationPickerProps {
  latitude: number | null;
  longitude: number | null;
  onLocationChange: (lat: number | null, lng: number | null) => void;
  locationText?: string;
}

// Default center: Ho Chi Minh City
const DEFAULT_CENTER: [number, number] = [10.7769, 106.7009];

export const MapLocationPicker = ({ latitude, longitude, onLocationChange, locationText }: MapLocationPickerProps) => {
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const geocodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastGeocodedTextRef = useRef<string>('');

  // Place or move marker on the map
  const placeMarker = useCallback((lat: number, lng: number) => {
    if (!mapInstanceRef.current) return;
    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lng]);
    } else {
      markerRef.current = L.marker([lat, lng]).addTo(mapInstanceRef.current);
    }
    mapInstanceRef.current.setView([lat, lng], 15);
  }, []);

  // Geocode address using Nominatim (free, no API key)
  const geocodeAddress = useCallback(async (address: string) => {
    if (!address || address.length < 5) return;
    // Don't re-geocode if we already have coords and text hasn't changed
    if (address === lastGeocodedTextRef.current) return;

    setIsGeocoding(true);
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1&countrycodes=vn`,
        { headers: { 'Accept-Language': 'en' } }
      );
      const results = await response.json();
      if (results && results.length > 0) {
        const { lat, lon } = results[0];
        const parsedLat = parseFloat(lat);
        const parsedLng = parseFloat(lon);
        lastGeocodedTextRef.current = address;
        onLocationChange(parsedLat, parsedLng);
        placeMarker(parsedLat, parsedLng);
      }
    } catch (error) {
      console.error('[MapLocationPicker] Geocoding failed:', error);
    } finally {
      setIsGeocoding(false);
    }
  }, [onLocationChange, placeMarker]);

  // Auto-geocode when location text changes (debounced)
  useEffect(() => {
    if (!locationText || locationText.length < 5) return;
    // Only auto-geocode if no pin exists yet
    if (latitude && longitude) return;

    if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current);
    geocodeTimerRef.current = setTimeout(() => {
      geocodeAddress(locationText);
    }, 1500);

    return () => {
      if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current);
    };
  }, [locationText, latitude, longitude, geocodeAddress]);

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

      for (const layer of basemap.layers) {
        L.tileLayer(layer.url, {
          attribution: layer.attribution,
          subdomains: layer.subdomains ?? 'abc',
          maxZoom: layer.maxZoom,
          maxNativeZoom: layer.maxNativeZoom,
        }).addTo(map);
      }

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
        lastGeocodedTextRef.current = locationText || '';
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

  // Sync marker position when lat/lng changes externally (e.g. from geocoding)
  useEffect(() => {
    if (!mapInstanceRef.current || !latitude || !longitude) return;
    placeMarker(latitude, longitude);
  }, [latitude, longitude, placeMarker]);

  const clearLocation = () => {
    onLocationChange(null, null);
    lastGeocodedTextRef.current = '';
    if (markerRef.current && mapInstanceRef.current) {
      mapInstanceRef.current.removeLayer(markerRef.current);
      markerRef.current = null;
    }
  };

  const handleManualGeocode = () => {
    if (locationText) {
      lastGeocodedTextRef.current = ''; // Force re-geocode
      geocodeAddress(locationText);
    }
  };

  return (
    <div className="space-y-2">
      <Label className="text-sm">Pin Location on Map (Optional)</Label>
      <div className="flex items-center gap-2 flex-wrap">
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
        {locationText && locationText.length >= 5 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleManualGeocode}
            disabled={isGeocoding}
            className="gap-1.5"
          >
            {isGeocoding ? <Loader2 className="w-3 h-3 animate-spin" /> : <MapPin className="w-3 h-3" />}
            {isGeocoding ? 'Finding...' : 'Auto-detect from address'}
          </Button>
        )}
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
          <p className="text-xs text-muted-foreground px-2 py-1 bg-muted">Click on the map to set the property location, or use "Auto-detect" to geocode the address</p>
        </div>
      )}
    </div>
  );
};
