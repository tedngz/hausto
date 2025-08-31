export type UserPreferences = {
  styles: string[];
  colors: string[];
  activities: string[];
  priceRange: [number, number];
  size: string;
  location: string[];
  moveInDate: string;
};

export type Apartment = {
  id: string;
  images: string[];
  title: string;
  location: string;
  price: number;
  size: string;
  vibe: string;
  description: string;
  highlights: string[];
  realtor: {
    id: string;
    name: string;
    phone: string;
    email: string;
    avatar?: string;
  };
  matchId?: string;
  vibe_analysis?: any;
};

export type Match = {
  id: string;
  apartmentId: string;
  renterId: string;
  realtorId: string;
  timestamp: Date;
  apartment: Apartment;
  renterPreferences: UserPreferences;
};