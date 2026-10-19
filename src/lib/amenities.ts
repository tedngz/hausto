// Amenity names as the crawler and the AI hand them over, normalized for
// display: noise filtered out, near-duplicates folded onto one key, and an
// icon where one fits. Shared by PropertyAmenities and the cards that lay
// amenities out themselves.
import { Tv, Wifi, Wind, Waves, Car, Dumbbell, Shield, Flower2, Flame, Bath, Sparkles, Briefcase, Home, ChefHat, Utensils, Sofa, PawPrint, WashingMachine, Sun, Bed, Archive, BookOpen, Armchair, Table, Fan, Radio, Volume2, Flower, Image, Lamp } from 'lucide-react';

export const amenityIconMap: Record<string, { icon: any; label: string }> = {
  // Entertainment
  'TV': { icon: Tv, label: 'TV' },
  'Smart TV': { icon: Tv, label: 'Smart TV' },
  'Large Screen TV': { icon: Tv, label: 'Large TV' },
  'Television': { icon: Tv, label: 'TV' },
  
  // Connectivity
  'WiFi Router': { icon: Wifi, label: 'WiFi' },
  'Internet Equipment': { icon: Wifi, label: 'Internet' },
  'WiFi': { icon: Wifi, label: 'WiFi' },
  'Wi-Fi': { icon: Wifi, label: 'WiFi' },
  
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
  'Fridge': { icon: ChefHat, label: 'Fridge' },
  
  // Fitness & Wellness
  'Gym Equipment': { icon: Dumbbell, label: 'Gym' },
  'Gym': { icon: Dumbbell, label: 'Gym' },
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
  'Pet Friendly': { icon: PawPrint, label: 'Pet Friendly' },
  
  // Premium Features
  'Fireplace': { icon: Flame, label: 'Fireplace' },
  'Heating': { icon: Flame, label: 'Heating' },
  'Walk-in Closet': { icon: Sofa, label: 'Walk-in Closet' },
  'Storage': { icon: Sofa, label: 'Storage' },
  'Kitchen Island': { icon: ChefHat, label: 'Kitchen Island' },
  'Breakfast Bar': { icon: ChefHat, label: 'Breakfast Bar' },
  'Hardwood Floors': { icon: Sparkles, label: 'Hardwood' },
  'Wood Floor': { icon: Sparkles, label: 'Hardwood' },
  'Marble': { icon: Sparkles, label: 'Marble' },
  'Premium Finishes': { icon: Sparkles, label: 'Premium' },
  'Smart Home Devices': { icon: Sparkles, label: 'Smart Home' },
  'Automation': { icon: Sparkles, label: 'Automation' },
  'Natural Light': { icon: Sun, label: 'Natural Light' },
  'Large Windows': { icon: Sun, label: 'Large Windows' },
  'Large Window': { icon: Sun, label: 'Large Windows' },
  
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
  'Sofa': { icon: Sofa, label: 'Sofa' },
  
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

export const isValidAmenity = (amenity: string): boolean => {
  const trimmed = amenity.trim();
  if (trimmed.length < 2 || trimmed.length > 40) return false;
  return !NON_AMENITY_PATTERNS.some(pattern => pattern.test(trimmed));
};

// Longest first, so "coffee table" finds "Coffee Table" before "Table".
const KEYS_LONGEST_FIRST = Object.keys(amenityIconMap).sort((a, b) => b.length - a.length);

// Normalize amenity names to match icon keys. A name folds onto a key it
// contains as a whole word ("Electric Stove" -> Stove), never onto a key that
// merely contains it: that read "bed" as "Pet Bed" and labelled every listing
// with a bed in its photos Pet Friendly.
export const normalizeAmenity = (amenity: string): string => {
  const normalized = amenity.trim();
  if (amenityIconMap[normalized]) return normalized;

  const lower = normalized.toLowerCase();
  for (const key of KEYS_LONGEST_FIRST) {
    const k = key.toLowerCase();
    if (lower === k) return key;
    const at = lower.indexOf(k);
    if (at === -1) continue;
    const before = lower[at - 1];
    // A plural still matches: "Ceiling fans" is a Ceiling Fan.
    const end = at + k.length + (lower[at + k.length] === 's' ? 1 : 0);
    const after = lower[end];
    if ((!before || !/[a-z0-9]/.test(before)) && (!after || !/[a-z0-9]/.test(after))) return key;
  }
  return normalized;
};

export interface NormalizedAmenity {
  /** Normalized amenity key (also used as a React key) */
  key: string;
  /** Display label — the mapped friendly name, or the raw AI-detected text */
  label: string;
  /** Lucide icon when the amenity maps to a known one */
  icon?: any;
}

/**
 * Deduplicate, filter out non-amenity noise, and normalize a raw amenity list
 * into display-ready items. Shared so callers can lay amenities out themselves
 * (e.g. the listing page's grid) without duplicating the icon map.
 */
export const getNormalizedAmenities = (amenities?: string[] | null, limit = 12): NormalizedAmenity[] => {
  if (!amenities || amenities.length === 0) return [];
  // Deduplicated on the label shown, not the key: "TV" and "Television", or
  // "sofa" and "Sofa", are one thing to the renter reading the list.
  const seen = new Set<string>();
  const out: NormalizedAmenity[] = [];
  for (const raw of amenities) {
    if (typeof raw !== 'string' || !isValidAmenity(raw)) continue;
    const key = normalizeAmenity(raw);
    if (!isValidAmenity(key)) continue;
    const mapped = amenityIconMap[key];
    const label = mapped?.label ?? key;
    if (seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    out.push({ key, label, icon: mapped?.icon });
    if (out.length >= limit) break;
  }
  return out;
};
