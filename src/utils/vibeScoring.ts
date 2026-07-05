
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

const toStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
  }

  return [];
};

const normalizePreferencePayload = (preferences: UserPreferences) => ({
  styles: toStringArray(preferences?.styles),
  colors: toStringArray(preferences?.colors),
  activities: toStringArray(preferences?.activities),
  location: toStringArray(preferences?.location),
  priceRange: Array.isArray(preferences?.priceRange) && preferences.priceRange.length === 2
    ? preferences.priceRange
    : [0, Number.MAX_SAFE_INTEGER] as [number, number],
});

const getVibeMetrics = (apartment: Apartment) => {
  const vibeAnalysis = (apartment as any).vibe_analysis;
  return vibeAnalysis && typeof vibeAnalysis === 'object' ? vibeAnalysis : null;
};

export interface VibeAttribute {
  label: string;
  matched: boolean;
}

export interface VibeAttributeMatch {
  style: VibeAttribute[];
  color: VibeAttribute[];
  lifestyle: VibeAttribute[];
  hasAny: boolean;
}

// Categorise the property's AI-detected styles/colors/lifestyle and flag which
// ones align with the renter's stated preferences. Powers the vibe-match
// popover so renters see WHAT matches, not just a percentage.
export const getVibeAttributeMatch = (apartment: Apartment, preferences: UserPreferences): VibeAttributeMatch => {
  const vibeAnalysis = getVibeMetrics(apartment) || {};
  const prefs = normalizePreferencePayload(preferences);

  const build = (propertyVals: string[], userVals: string[]): VibeAttribute[] => {
    const userLower = new Set(userVals.map(v => v.toLowerCase()));
    const seen = new Set<string>();
    const out: VibeAttribute[] = [];
    for (const raw of propertyVals) {
      const key = raw.toLowerCase().trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ label: raw.trim(), matched: userLower.has(key) });
    }
    // Sort matched first so the alignment is obvious at a glance.
    return out.sort((a, b) => Number(b.matched) - Number(a.matched)).slice(0, 6);
  };

  const style = build(toStringArray(vibeAnalysis.styles), prefs.styles);
  const color = build(toStringArray(vibeAnalysis.colors), prefs.colors);
  const lifestyle = build(toStringArray(vibeAnalysis.activities), prefs.activities);

  return { style, color, lifestyle, hasAny: style.length + color.length + lifestyle.length > 0 };
};

export const calculateVibeScore = (apartment: Apartment, preferences: UserPreferences): VibeScore => {
  const normalizedPreferences = normalizePreferencePayload(preferences);

  const styleScore = calculateStyleMatch(apartment, normalizedPreferences.styles);
  const locationScore = calculateLocationMatch(apartment.location, normalizedPreferences.location);
  const colorScore = calculateColorMatch(apartment, normalizedPreferences.colors);
  const activityScore = calculateActivityMatch(apartment, normalizedPreferences.activities);
  const priceScore = calculatePriceMatch(apartment.price, normalizedPreferences.priceRange);

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
  const vibeAnalysis = getVibeMetrics(apartment);
  const storedStyles = toStringArray(vibeAnalysis?.styles);

  if (storedStyles.length > 0) {
    userStyles.forEach(userStyle => {
      if (storedStyles.some((s) => s.toLowerCase() === userStyle.toLowerCase())) {
        matchScore += 30;
      }
    });

    matchScore = matchScore > 0 ? matchScore + 40 : 30;
  } else if (vibeAnalysis) {
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
        const metricValue = typeof vibeAnalysis[metric] === 'number' ? vibeAnalysis[metric] : 0;
        if (metricValue >= 7) {
          matchScore += 25;
        } else if (metricValue >= 5) {
          matchScore += 15;
        }
      });
    });

    if (
      (typeof vibeAnalysis.elegant === 'number' && vibeAnalysis.elegant >= 7) ||
      (typeof vibeAnalysis.spacious === 'number' && vibeAnalysis.spacious >= 7) ||
      (typeof vibeAnalysis.natural_light === 'number' && vibeAnalysis.natural_light >= 8)
    ) {
      matchScore += 20;
    }
  } else {
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
  const vibeAnalysis = getVibeMetrics(apartment);
  const storedColors = toStringArray(vibeAnalysis?.colors);

  if (storedColors.length > 0) {
    userColors.forEach(userColor => {
      if (storedColors.some((c) => c.toLowerCase() === userColor.toLowerCase())) {
        matchScore += 30;
      }
    });

    matchScore = matchScore > 0 ? matchScore + 40 : 30;
  } else if (vibeAnalysis) {
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
        const metricValue = typeof vibeAnalysis[metric] === 'number' ? vibeAnalysis[metric] : 0;
        if (metricValue >= 7) {
          matchScore += 25;
        } else if (metricValue >= 5) {
          matchScore += 15;
        }
      });
    });

    if (typeof vibeAnalysis.natural_light === 'number' && vibeAnalysis.natural_light >= 8) {
      matchScore += 20;
    }

    if (userColors.some(c => c.toLowerCase() === 'colorful') && typeof vibeAnalysis.colorful === 'number' && vibeAnalysis.colorful >= 6) {
      matchScore += 30;
    }
  } else {
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
  const vibeAnalysis = getVibeMetrics(apartment);
  const storedActivities = toStringArray(vibeAnalysis?.activities);

  if (storedActivities.length > 0) {
    userActivities.forEach(userActivity => {
      if (storedActivities.some((a) => a.toLowerCase() === userActivity.toLowerCase())) {
        matchScore += 30;
      }
    });

    matchScore = matchScore > 0 ? matchScore + 40 : 30;
  } else {
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
  if (!propertyLocation || userLocations.length === 0) {
    return 50;
  }

  if (userLocations.includes(propertyLocation)) {
    return 100;
  }

  const propertyCity = propertyLocation.split(',')[1]?.trim();
  const userCities = userLocations.map(loc => loc.split(',')[1]?.trim());

  if (propertyCity && userCities.includes(propertyCity)) {
    return 60;
  }

  return 0;
};

const calculatePriceMatch = (apartmentPrice: number, priceRange: [number, number]): number => {
  const [min, max] = priceRange;

  if (apartmentPrice >= min && apartmentPrice <= max) {
    return 100;
  }

  if (apartmentPrice < min) {
    const diff = min - apartmentPrice;
    return min > 0 ? Math.max(60, 100 - (diff / min) * 40) : 100;
  }

  const diff = apartmentPrice - max;
  return max > 0 ? Math.max(20, 100 - (diff / max) * 80) : 20;
};
