import { Tv, Wifi, Wind, Waves, Car, Dumbbell, Shield, Flower2, Flame, Bath, Sparkles, Briefcase, Home, ChefHat, Utensils, Sofa, PawPrint, WashingMachine, Sun, Bed, Archive, BookOpen, Armchair, Table, Fan, Radio, Volume2, Flower, Image, Lamp } from 'lucide-react';

interface PropertyAmenitiesProps {
  amenities: string[];
  compact?: boolean;
}

const amenityIconMap: Record<string, { icon: any; label: string }> = {
  // Entertainment
  'TV': { icon: Tv, label: 'TV' },
  'Smart TV': { icon: Tv, label: 'Smart TV' },
  'Large Screen TV': { icon: Tv, label: 'Large TV' },
  
  // Connectivity
  'WiFi Router': { icon: Wifi, label: 'WiFi' },
  'Internet Equipment': { icon: Wifi, label: 'Internet' },
  'WiFi': { icon: Wifi, label: 'WiFi' },
  
  // Climate
  'Air Conditioning': { icon: Wind, label: 'AC' },
  'AC Unit': { icon: Wind, label: 'AC' },
  'Climate Control': { icon: Wind, label: 'Climate Control' },
  
  // Appliances
  'Washing Machine': { icon: WashingMachine, label: 'Washer' },
  'Dryer': { icon: WashingMachine, label: 'Dryer' },
  'Laundry': { icon: WashingMachine, label: 'Laundry' },
  'Dishwasher': { icon: Utensils, label: 'Dishwasher' },
  'Kitchen Appliances': { icon: ChefHat, label: 'Appliances' },
  'Microwave': { icon: ChefHat, label: 'Microwave' },
  'Oven': { icon: ChefHat, label: 'Oven' },
  'Stove': { icon: ChefHat, label: 'Stove' },
  'Refrigerator': { icon: ChefHat, label: 'Fridge' },
  
  // Fitness & Wellness
  'Gym Equipment': { icon: Dumbbell, label: 'Gym' },
  'Fitness Area': { icon: Dumbbell, label: 'Fitness' },
  'Pool': { icon: Waves, label: 'Pool' },
  'Swimming Pool': { icon: Waves, label: 'Pool' },
  'Bathtub': { icon: Bath, label: 'Bathtub' },
  'Jacuzzi': { icon: Bath, label: 'Jacuzzi' },
  'Spa': { icon: Bath, label: 'Spa' },
  
  // Outdoor
  'Balcony': { icon: Home, label: 'Balcony' },
  'Terrace': { icon: Home, label: 'Terrace' },
  'Outdoor Space': { icon: Home, label: 'Outdoor' },
  'Garden': { icon: Flower2, label: 'Garden' },
  'Green Space': { icon: Flower2, label: 'Green Space' },
  
  // Parking & Transport
  'Parking': { icon: Car, label: 'Parking' },
  'Garage': { icon: Car, label: 'Garage' },
  'Car Space': { icon: Car, label: 'Parking' },
  
  // Security
  'Security System': { icon: Shield, label: 'Security' },
  'Cameras': { icon: Shield, label: 'Security' },
  'Safe': { icon: Shield, label: 'Safe' },
  
  // Work & Living
  'Workspace': { icon: Briefcase, label: 'Workspace' },
  'Desk': { icon: Briefcase, label: 'Desk' },
  'Office Setup': { icon: Briefcase, label: 'Office' },
  
  // Pet
  'Pet Amenities': { icon: PawPrint, label: 'Pet Friendly' },
  'Pet Bed': { icon: PawPrint, label: 'Pet Friendly' },
  'Pet Bowls': { icon: PawPrint, label: 'Pet Friendly' },
  
  // Premium Features
  'Fireplace': { icon: Flame, label: 'Fireplace' },
  'Heating': { icon: Flame, label: 'Heating' },
  'Walk-in Closet': { icon: Sofa, label: 'Walk-in Closet' },
  'Storage': { icon: Sofa, label: 'Storage' },
  'Kitchen Island': { icon: ChefHat, label: 'Kitchen Island' },
  'Breakfast Bar': { icon: ChefHat, label: 'Breakfast Bar' },
  'Hardwood Floors': { icon: Sparkles, label: 'Hardwood' },
  'Marble': { icon: Sparkles, label: 'Marble' },
  'Premium Finishes': { icon: Sparkles, label: 'Premium' },
  'Smart Home Devices': { icon: Sparkles, label: 'Smart Home' },
  'Automation': { icon: Sparkles, label: 'Automation' },
  'Natural Light': { icon: Sun, label: 'Natural Light' },
  'Large Windows': { icon: Sun, label: 'Large Windows' },
  
  // Furniture
  'Bed': { icon: Bed, label: 'Bed' },
  'Queen Bed': { icon: Bed, label: 'Queen Bed' },
  'King Bed': { icon: Bed, label: 'King Bed' },
  'Double Bed': { icon: Bed, label: 'Double Bed' },
  'Cabinets': { icon: Archive, label: 'Cabinets' },
  'Storage Cabinets': { icon: Archive, label: 'Storage' },
  'Shelves': { icon: BookOpen, label: 'Shelves' },
  'Bookshelf': { icon: BookOpen, label: 'Bookshelf' },
  'Chair': { icon: Armchair, label: 'Chair' },
  'Dining Chair': { icon: Armchair, label: 'Dining Chair' },
  'Office Chair': { icon: Armchair, label: 'Office Chair' },
  'Table': { icon: Table, label: 'Table' },
  'Dining Table': { icon: Table, label: 'Dining Table' },
  'Coffee Table': { icon: Table, label: 'Coffee Table' },
  'Couch': { icon: Sofa, label: 'Couch' },
  'Sectional': { icon: Sofa, label: 'Sectional' },
  
  // Electronics
  'Fan': { icon: Fan, label: 'Fan' },
  'Ceiling Fan': { icon: Fan, label: 'Ceiling Fan' },
  'Air Purifier': { icon: Wind, label: 'Air Purifier' },
  'Vacuum Cleaner': { icon: Wind, label: 'Vacuum' },
  'Speaker': { icon: Volume2, label: 'Speaker' },
  'Sound System': { icon: Volume2, label: 'Sound System' },
  'Radio': { icon: Radio, label: 'Radio' },
  
  // Decoration
  'Plants': { icon: Flower, label: 'Plants' },
  'Indoor Plants': { icon: Flower, label: 'Indoor Plants' },
  'Painting': { icon: Image, label: 'Painting' },
  'Artwork': { icon: Image, label: 'Artwork' },
  'Wall Art': { icon: Image, label: 'Wall Art' },
  'Chandelier': { icon: Lamp, label: 'Chandelier' },
  'Lighting': { icon: Lamp, label: 'Lighting' },
  'Pendant Light': { icon: Lamp, label: 'Pendant Light' },
};

// Filter out non-amenity items that AI sometimes includes
const NON_AMENITY_PATTERNS = [
  /deposit/i, /tiền cọc/i, /đặt cọc/i,
  /bedroom/i, /phòng ngủ/i, /studio/i, /penthouse/i, /shared room/i,
  /triệu|million|vnd|usd|\$/i,
  /floor\s*\d/i, /tầng\s*\d/i,
  /payment/i, /rental\s*term/i, /contract/i, /lease/i,
  /apartment\s*type/i, /property\s*type/i,
  /^\d+\s*(m²|sqm|sq\s*ft|bedrooms?|rooms?|bathrooms?)$/i,
  /per\s*month/i, /\/month/i, /\/mo/i,
];

const isValidAmenity = (amenity: string): boolean => {
  const trimmed = amenity.trim();
  if (trimmed.length < 2 || trimmed.length > 40) return false;
  return !NON_AMENITY_PATTERNS.some(pattern => pattern.test(trimmed));
};

// Normalize amenity names to match icon keys
const normalizeAmenity = (amenity: string): string => {
  const normalized = amenity.trim();
  // Try direct match first
  if (amenityIconMap[normalized]) return normalized;
  
  // Try fuzzy matching
  const lower = normalized.toLowerCase();
  for (const key of Object.keys(amenityIconMap)) {
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) {
      return key;
    }
  }
  return normalized;
};

export const PropertyAmenities = ({ amenities, compact = true }: PropertyAmenitiesProps) => {
  if (!amenities || amenities.length === 0) return null;

  // Deduplicate, filter, and normalize amenities
  const uniqueAmenities = Array.from(new Set(amenities.filter(isValidAmenity).map(normalizeAmenity)))
    .filter(a => isValidAmenity(a))
    .slice(0, compact ? 8 : 12);

  if (uniqueAmenities.length === 0) return null;

  return (
    <div className={`flex flex-wrap gap-2 ${compact ? 'py-2' : 'py-3'}`}>
      {uniqueAmenities.map((amenity) => {
        const mapped = amenityIconMap[amenity];
        
        if (mapped) {
          const { icon: Icon, label } = mapped;
          return (
            <div
              key={amenity}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted/50 border border-border text-muted-foreground ${compact ? 'text-xs' : 'text-sm'}`}
              title={label}
            >
              <Icon className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
              <span className="font-medium">{label}</span>
            </div>
          );
        }
        
        // Render AI-detected amenities without icons
        return (
          <div
            key={amenity}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted/50 border border-border text-muted-foreground ${compact ? 'text-xs' : 'text-sm'}`}
            title={amenity}
          >
            <span className="font-medium">{amenity}</span>
          </div>
        );
      })}
    </div>
  );
};
