import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MapPin, Info } from 'lucide-react';

const DISTRICT_DESCRIPTIONS: Record<string, string> = {
  'quận 1': 'Business hub with luxury shopping, fine dining, and vibrant nightlife',
  'district 1': 'Business hub with luxury shopping, fine dining, and vibrant nightlife',
  'd1': 'Business hub with luxury shopping, fine dining, and vibrant nightlife',
  'quận 2': 'Modern expat area with international schools and riverside living',
  'district 2': 'Modern expat area with international schools and riverside living',
  'd2': 'Modern expat area with international schools and riverside living',
  'quận 3': 'Local culture mix with cafes, street food, and affordable living',
  'district 3': 'Local culture mix with cafes, street food, and affordable living',
  'd3': 'Local culture mix with cafes, street food, and affordable living',
  'quận 4': 'Authentic local life with traditional markets and riverside views',
  'district 4': 'Authentic local life with traditional markets and riverside views',
  'd4': 'Authentic local life with traditional markets and riverside views',
  'quận 5': 'Chinatown district with rich heritage, temples, and bustling markets',
  'district 5': 'Chinatown district with rich heritage, temples, and bustling markets',
  'd5': 'Chinatown district with rich heritage, temples, and bustling markets',
  'quận 6': 'Traditional neighborhood with local markets and authentic cuisine',
  'district 6': 'Traditional neighborhood with local markets and authentic cuisine',
  'd6': 'Traditional neighborhood with local markets and authentic cuisine',
  'quận 7': 'Planned urban area popular with expats, near Phú Mỹ Hưng new town',
  'district 7': 'Planned urban area popular with expats, near Phú Mỹ Hưng new town',
  'd7': 'Planned urban area popular with expats, near Phú Mỹ Hưng new town',
  'quận 8': 'Riverside district with local charm and growing development',
  'district 8': 'Riverside district with local charm and growing development',
  'd8': 'Riverside district with local charm and growing development',
  'quận 9': 'Hi-tech park area with green spaces and modern developments',
  'district 9': 'Hi-tech park area with green spaces and modern developments',
  'd9': 'Hi-tech park area with green spaces and modern developments',
  'quận 10': 'Central district with diverse food scene and local markets',
  'district 10': 'Central district with diverse food scene and local markets',
  'd10': 'Central district with diverse food scene and local markets',
  'quận 11': 'Residential area with traditional markets and local eateries',
  'district 11': 'Residential area with traditional markets and local eateries',
  'd11': 'Residential area with traditional markets and local eateries',
  'quận 12': 'Suburban feel with parks, affordable housing, and growing infrastructure',
  'district 12': 'Suburban feel with parks, affordable housing, and growing infrastructure',
  'd12': 'Suburban feel with parks, affordable housing, and growing infrastructure',
  'bình thạnh': 'Trendy neighborhood with cafes, co-working spaces, and young professionals',
  'binh thanh': 'Trendy neighborhood with cafes, co-working spaces, and young professionals',
  'phú nhuận': 'Central residential area with great food streets and local charm',
  'phu nhuan': 'Central residential area with great food streets and local charm',
  'tân bình': 'Near the airport with diverse dining and bustling commercial streets',
  'tan binh': 'Near the airport with diverse dining and bustling commercial streets',
  'tân phú': 'Family-friendly area with parks, schools, and growing amenities',
  'tan phu': 'Family-friendly area with parks, schools, and growing amenities',
  'gò vấp': 'Lively residential district with markets and affordable living',
  'go vap': 'Lively residential district with markets and affordable living',
  'thủ đức': 'University town with tech parks, nature, and modern developments',
  'thu duc': 'University town with tech parks, nature, and modern developments',
  'bình tân': 'Industrial-residential mix with affordable options and local markets',
  'binh tan': 'Industrial-residential mix with affordable options and local markets',
  'nhà bè': 'Quiet suburban area with riverside charm south of the city',
  'nha be': 'Quiet suburban area with riverside charm south of the city',
  // Hanoi
  'ba đình': 'Political center with historic sites, embassies, and tree-lined streets',
  'ba dinh': 'Political center with historic sites, embassies, and tree-lined streets',
  'hoàn kiếm': 'Old Quarter charm with Hoan Kiem Lake, heritage, and vibrant street life',
  'hoan kiem': 'Old Quarter charm with Hoan Kiem Lake, heritage, and vibrant street life',
  'đống đa': 'Cultural district with universities, temples, and local neighborhoods',
  'dong da': 'Cultural district with universities, temples, and local neighborhoods',
  'cầu giấy': 'Modern urban center with tech companies and young professionals',
  'cau giay': 'Modern urban center with tech companies and young professionals',
  'tây hồ': 'Lakeside expat hub with international restaurants and peaceful living',
  'tay ho': 'Lakeside expat hub with international restaurants and peaceful living',
  // Da Nang
  'hải châu': 'Downtown Da Nang with Han River views and urban conveniences',
  'hai chau': 'Downtown Da Nang with Han River views and urban conveniences',
  'sơn trà': 'Beachside living near My Khe Beach and Son Tra Peninsula',
  'son tra': 'Beachside living near My Khe Beach and Son Tra Peninsula',
  'ngũ hành sơn': 'Coastal area near Marble Mountains with resort-style living',
  'ngu hanh son': 'Coastal area near Marble Mountains with resort-style living',
};

function getLocationDescription(location: string): string | null {
  const lower = location.toLowerCase();
  for (const [key, desc] of Object.entries(DISTRICT_DESCRIPTIONS)) {
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

  const locationDesc = getLocationDescription(location);

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
          style={{ height: '350px', minHeight: '350px', position: 'relative', zIndex: 1 }}
        />
        {locationDesc && (
          <div className="px-4 py-3 border-t border-border bg-muted/30 flex items-start gap-2">
            <Info className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
            <p className="text-sm text-muted-foreground leading-relaxed">{locationDesc}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
