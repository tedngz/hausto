
import { UserPreferences, Apartment } from '@/pages/Index';

export interface VibeScore {
  overall: number;
  breakdown: {
    style: number;
    color: number;
    activities: number;
    price: number;
  };
}

export const calculateVibeScore = (apartment: Apartment, preferences: UserPreferences): VibeScore => {
  // Style matching (40% weight)
  const styleScore = calculateStyleMatch(apartment, preferences.styles);
  
  // Color matching (25% weight)
  const colorScore = calculateColorMatch(apartment, preferences.colors);
  
  // Activities matching (25% weight)
  const activityScore = calculateActivityMatch(apartment, preferences.activities);
  
  // Price matching (10% weight)
  const priceScore = calculatePriceMatch(apartment.price, preferences.priceRange);
  
  const overall = Math.round(
    styleScore * 0.4 + 
    colorScore * 0.25 + 
    activityScore * 0.25 + 
    priceScore * 0.1
  );

  return {
    overall,
    breakdown: {
      style: Math.round(styleScore),
      color: Math.round(colorScore),
      activities: Math.round(activityScore),
      price: Math.round(priceScore)
    }
  };
};

const calculateStyleMatch = (apartment: Apartment, userStyles: string[]): number => {
  let matchScore = 0;
  
  // First, try to use AI-detected style metrics from vibe_analysis
  const vibeAnalysis = (apartment as any).vibe_analysis;
  if (vibeAnalysis) {
    // Map user style preferences to AI analysis metrics
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
          matchScore += 25; // Higher score for AI-detected strong matches
        } else if (vibeAnalysis[metric] && vibeAnalysis[metric] >= 5) {
          matchScore += 15; // Moderate score for medium matches
        }
      });
    });
    
    // Bonus for overall quality metrics
    if (vibeAnalysis.elegant >= 7 || vibeAnalysis.spacious >= 7 || vibeAnalysis.natural_light >= 8) {
      matchScore += 20;
    }
  } else {
    // Fallback to original logic if no AI analysis available
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
  
  // First, try to use AI-detected color metrics from vibe_analysis
  const vibeAnalysis = (apartment as any).vibe_analysis;
  if (vibeAnalysis) {
    // Map user color preferences to AI analysis metrics
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
          matchScore += 25; // Higher score for AI-detected strong color matches
        } else if (vibeAnalysis[metric] && vibeAnalysis[metric] >= 5) {
          matchScore += 15; // Moderate score for medium matches
        }
      });
    });
    
    // Special bonus for natural light as it affects color perception
    if (vibeAnalysis.natural_light >= 8) {
      matchScore += 20;
    }
    
    // Bonus for colorful properties if user likes colorful spaces
    if (userColors.includes('colorful') && vibeAnalysis.colorful >= 6) {
      matchScore += 30;
    }
  } else {
    // Fallback to original logic if no AI analysis available
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
  // Updated activity mapping for new vibe system
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
    
    // Fallback mappings
    'Modern Minimalist': ['working', 'reading', 'relaxing'],
    'Urban Sanctuary': ['working', 'entertaining', 'exercising'],
    'Creative Haven': ['working', 'creating', 'entertaining'],
    'Cozy Traditional': ['reading', 'relaxing', 'cooking', 'family time'],
    'Industrial Chic': ['working', 'entertaining', 'exercising'],
    'Bohemian Eclectic': ['creating', 'entertaining', 'relaxing'],
    'Zen Retreat': ['relaxing', 'exercising', 'reading', 'meditating']
  };

  const apartmentActivities = apartmentActivityMap[apartment.vibe] || [];
  let matchScore = 0;
  
  userActivities.forEach(userActivity => {
    if (apartmentActivities.includes(userActivity.toLowerCase())) {
      matchScore += 20; // Each match adds 20 points
    }
  });
  
  // Add base score - be more generous
  if (apartmentActivities.length > 0 || apartment.vibe) {
    matchScore += 50; // Higher base activity compatibility
  }
  
  return Math.min(100, matchScore);
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
