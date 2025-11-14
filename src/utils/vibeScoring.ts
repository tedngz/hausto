
import { UserPreferences, Apartment } from '@/types';

export interface VibeScore {
  overall: number;
  breakdown: {
    style: number;
    color: number;
    activities: number;
    price: number;
    location: number;
  };
}

export const calculateVibeScore = (apartment: Apartment, preferences: UserPreferences): VibeScore => {
  // Style matching (30% weight)
  const styleScore = calculateStyleMatch(apartment, preferences.styles);
  
  // Location matching (20% weight)
  const locationScore = calculateLocationMatch(apartment.location, preferences.location);
  
  // Color matching (20% weight)
  const colorScore = calculateColorMatch(apartment, preferences.colors);
  
  // Activities matching (20% weight)
  const activityScore = calculateActivityMatch(apartment, preferences.activities);
  
  // Price matching (10% weight)
  const priceScore = calculatePriceMatch(apartment.price, preferences.priceRange);
  
  const overall = Math.round(
    styleScore * 0.30 + 
    locationScore * 0.20 +
    colorScore * 0.20 + 
    activityScore * 0.20 + 
    priceScore * 0.10
  );

  return {
    overall,
    breakdown: {
      style: Math.round(styleScore),
      color: Math.round(colorScore),
      activities: Math.round(activityScore),
      price: Math.round(priceScore),
      location: Math.round(locationScore)
    }
  };
};

const calculateStyleMatch = (apartment: Apartment, userStyles: string[]): number => {
  let matchScore = 0;
  
  // First, try to use stored styles from vibe_analysis
  const vibeAnalysis = (apartment as any).vibe_analysis;
  const storedStyles = vibeAnalysis?.styles || [];
  
  if (storedStyles.length > 0) {
    // Direct style matching (case-insensitive)
    userStyles.forEach(userStyle => {
      if (storedStyles.some((s: string) => s.toLowerCase() === userStyle.toLowerCase())) {
        matchScore += 30; // Strong match for direct style overlap
      }
    });
    
    // Base score if any styles are present
    if (matchScore > 0) {
      matchScore += 40;
    } else {
      matchScore = 30; // Base compatibility score
    }
  } else if (vibeAnalysis) {
    // Fallback to AI metrics if no stored styles
    const styleMap: { [key: string]: string[] } = {
      'modern': ['modern', 'minimalist', 'contemporary'],
      'minimalist': ['minimalist', 'modern', 'elegant'],
      'cozy': ['cozy', 'rustic'],
      'industrial': ['urban', 'modern'],
      'bohemian': ['colorful'],
      'scandinavian': ['minimalist', 'elegant', 'natural_light'],
      'contemporary': ['modern', 'elegant'],
      'traditional': ['cozy', 'rustic'],
      'rustic': ['rustic', 'cozy'],
      'luxury': ['luxurious', 'elegant', 'spacious'],
      'urban': ['urban', 'modern'],
      'vintage': ['rustic', 'cozy']
    };
    
    userStyles.forEach(userStyle => {
      const mappedMetrics = styleMap[userStyle.toLowerCase()] || [userStyle.toLowerCase()];
      mappedMetrics.forEach(metric => {
        if (vibeAnalysis[metric] && vibeAnalysis[metric] >= 7) {
          matchScore += 25;
        } else if (vibeAnalysis[metric] && vibeAnalysis[metric] >= 5) {
          matchScore += 15;
        }
      });
    });
    
    if (vibeAnalysis.elegant >= 7 || vibeAnalysis.spacious >= 7 || vibeAnalysis.natural_light >= 8) {
      matchScore += 20;
    }
  } else {
    // Last resort: use apartment vibe string
    const apartmentStyleMap: { [key: string]: string[] } = {
      'Modern': ['modern', 'minimalist', 'clean', 'sleek', 'contemporary'],
      'Cozy': ['cozy', 'traditional', 'warm', 'family', 'comfortable'],
      'Industrial': ['industrial', 'modern', 'urban', 'edgy', 'loft'],
      'Bohemian': ['bohemian', 'eclectic', 'colorful', 'artistic', 'creative'],
      'Scandinavian': ['scandinavian', 'minimalist', 'clean', 'natural', 'light'],
      'Minimalist': ['minimalist', 'clean', 'simple', 'modern', 'uncluttered'],
      'Contemporary': ['contemporary', 'modern', 'current', 'stylish', 'updated'],
      'Traditional': ['traditional', 'classic', 'timeless', 'conventional', 'cozy'],
      'Rustic': ['rustic', 'natural', 'countryside', 'wood', 'earthy'],
      'Luxury': ['luxury', 'upscale', 'premium', 'high-end', 'elegant'],
      'Urban': ['urban', 'city', 'metropolitan', 'modern', 'contemporary'],
      'Vintage': ['vintage', 'retro', 'classic', 'antique', 'period']
    };

    const apartmentStyles = apartmentStyleMap[apartment.vibe] || [];
    
    userStyles.forEach(userStyle => {
      if (apartmentStyles.includes(userStyle.toLowerCase())) {
        matchScore += 20;
      }
    });
    
    if (apartmentStyles.length > 0 || apartment.vibe) {
      matchScore += 50;
    }
  }
  
  return Math.min(100, matchScore);
};

const calculateColorMatch = (apartment: Apartment, userColors: string[]): number => {
  let matchScore = 0;
  
  // First, try to use stored colors from vibe_analysis
  const vibeAnalysis = (apartment as any).vibe_analysis;
  const storedColors = vibeAnalysis?.colors || [];
  
  if (storedColors.length > 0) {
    // Direct color matching (case-insensitive)
    userColors.forEach(userColor => {
      if (storedColors.some((c: string) => c.toLowerCase() === userColor.toLowerCase())) {
        matchScore += 30; // Strong match for direct color overlap
      }
    });
    
    // Base score if any colors are present
    if (matchScore > 0) {
      matchScore += 40;
    } else {
      matchScore = 30; // Base compatibility score
    }
  } else if (vibeAnalysis) {
    // Fallback to AI metrics if no stored colors
    const colorMap: { [key: string]: string[] } = {
      'neutral': ['minimalist', 'elegant'],
      'warm': ['cozy', 'rustic'],
      'cool': ['modern', 'urban'],
      'bright': ['colorful', 'natural_light'],
      'dark': ['luxurious', 'elegant'],
      'colorful': ['colorful'],
      'natural': ['rustic', 'natural_light'],
      'white': ['minimalist', 'modern', 'natural_light'],
      'earth': ['rustic', 'cozy'],
      'bold': ['colorful', 'modern']
    };
    
    userColors.forEach(userColor => {
      const mappedMetrics = colorMap[userColor.toLowerCase()] || [userColor.toLowerCase()];
      mappedMetrics.forEach(metric => {
        if (vibeAnalysis[metric] && vibeAnalysis[metric] >= 7) {
          matchScore += 25;
        } else if (vibeAnalysis[metric] && vibeAnalysis[metric] >= 5) {
          matchScore += 15;
        }
      });
    });
    
    if (vibeAnalysis.natural_light >= 8) {
      matchScore += 20;
    }
    
    if (userColors.some(c => c.toLowerCase() === 'colorful') && vibeAnalysis.colorful >= 6) {
      matchScore += 30;
    }
  } else {
    // Last resort: use apartment vibe string
    const apartmentColorMap: { [key: string]: string[] } = {
      'Modern': ['neutral', 'cool', 'white', 'grey'],
      'Cozy': ['warm', 'earth', 'brown', 'beige'],
      'Industrial': ['neutral', 'cool', 'metal', 'grey'],
      'Bohemian': ['warm', 'bold', 'colorful', 'earth'],
      'Scandinavian': ['neutral', 'white', 'natural', 'light'],
      'Minimalist': ['neutral', 'white', 'simple', 'clean'],
      'Contemporary': ['neutral', 'cool', 'modern', 'sleek'],
      'Traditional': ['warm', 'earth', 'classic', 'rich'],
      'Rustic': ['earth', 'natural', 'wood', 'warm'],
      'Luxury': ['rich', 'elegant', 'gold', 'sophisticated'],
      'Urban': ['neutral', 'cool', 'modern', 'grey'],
      'Vintage': ['classic', 'muted', 'antique', 'period']
    };

    const apartmentColors = apartmentColorMap[apartment.vibe] || [];
    
    userColors.forEach(userColor => {
      if (apartmentColors.includes(userColor.toLowerCase())) {
        matchScore += 20;
      }
    });
    
    if (apartmentColors.length > 0 || apartment.vibe) {
      matchScore += 50;
    }
  }
  
  return Math.min(100, matchScore);
};

const calculateActivityMatch = (apartment: Apartment, userActivities: string[]): number => {
  let matchScore = 0;
  
  // First, try to use stored activities from vibe_analysis
  const vibeAnalysis = (apartment as any).vibe_analysis;
  const storedActivities = vibeAnalysis?.activities || [];
  
  if (storedActivities.length > 0) {
    // Direct activity matching (case-insensitive)
    userActivities.forEach(userActivity => {
      if (storedActivities.some((a: string) => a.toLowerCase() === userActivity.toLowerCase())) {
        matchScore += 30; // Strong match for direct activity overlap
      }
    });
    
    // Base score if any activities are present
    if (matchScore > 0) {
      matchScore += 40;
    } else {
      matchScore = 30; // Base compatibility score
    }
  } else {
    // Fallback to vibe-based activity mapping
    const apartmentActivityMap: { [key: string]: string[] } = {
      'Modern': ['working', 'reading', 'relaxing', 'entertaining'],
      'Cozy': ['reading', 'relaxing', 'cooking', 'family time'],
      'Industrial': ['working', 'entertaining', 'exercising', 'creating'],
      'Bohemian': ['creating', 'entertaining', 'relaxing', 'artistic'],
      'Scandinavian': ['relaxing', 'reading', 'meditating', 'family time'],
      'Minimalist': ['relaxing', 'working', 'reading', 'meditating'],
      'Contemporary': ['working', 'entertaining', 'relaxing', 'socializing'],
      'Traditional': ['family time', 'cooking', 'reading', 'relaxing'],
      'Rustic': ['relaxing', 'cooking', 'family time', 'outdoor activities'],
      'Luxury': ['entertaining', 'relaxing', 'socializing', 'formal dining'],
      'Urban': ['working', 'socializing', 'exercising', 'entertainment'],
      'Vintage': ['collecting', 'reading', 'entertaining', 'crafting'],
    };

    const apartmentActivities = apartmentActivityMap[apartment.vibe] || [];
    
    userActivities.forEach(userActivity => {
      if (apartmentActivities.includes(userActivity.toLowerCase())) {
        matchScore += 20;
      }
    });
    
    if (apartmentActivities.length > 0 || apartment.vibe) {
      matchScore += 50;
    }
  }
  
  return Math.min(100, matchScore);
};

const calculateLocationMatch = (propertyLocation: string, userLocations: string[]): number => {
  if (!propertyLocation || !userLocations || userLocations.length === 0) {
    return 50; // Neutral score if no location data
  }

  // Check for exact match (district level)
  if (userLocations.includes(propertyLocation)) {
    return 100;
  }

  // Check for city match (same city, different district)
  const propertyCity = propertyLocation.split(',')[1]?.trim();
  const userCities = userLocations.map(loc => loc.split(',')[1]?.trim());
  
  if (propertyCity && userCities.includes(propertyCity)) {
    return 60; // Same city but different district
  }

  return 0; // No match at all
};

const calculatePriceMatch = (apartmentPrice: number, priceRange: [number, number]): number => {
  const [min, max] = priceRange;
  
  if (apartmentPrice >= min && apartmentPrice <= max) {
    return 100; // Perfect match if within range
  } else if (apartmentPrice < min) {
    // If cheaper than preferred, still good but not perfect
    const diff = min - apartmentPrice;
    return Math.max(60, 100 - (diff / min) * 40);
  } else {
    // If more expensive than preferred, penalize more
    const diff = apartmentPrice - max;
    return Math.max(20, 100 - (diff / max) * 80);
  }
};
