
import { UserPreferences, Apartment } from '@/types';
import {
  PropertyFeatures,
  FeatureKey,
  FeatureAttribute,
  extractPropertyFeatures,
  getFeatureMatch,
  propertyHasFeature,
  lifestyleToSoftFeatures,
  LIFESTYLE_FEATURE_MAP,
} from '@/lib/propertyFeatures';

export interface VibeScore {
  overall: number;
  /** True when the property is missing a hard must-have (grade is capped). */
  missingMustHave: boolean;
  breakdown: {
    style: number;
    features: number;
    price: number;
    location: number;
    /** Bedroom-count fit vs the quiz "how much room do you need" answer. */
    size?: number;
  };
}

// Quiz size answers and listing rooms strings, normalized to a bedroom count
// ordinal (studio = 0). Returns null when unparseable.
const roomsOrdinal = (value: string | null | undefined): number | null => {
  const v = String(value ?? '').toLowerCase();
  if (!v) return null;
  if (v.includes('studio')) return 0;
  const m = v.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
};

// Bedroom-count fit: exact answer = 100; one bigger is fine (70), one smaller
// is cramped (40); further off barely counts. Unknown on either side stays
// neutral so unparsed data isn't punished.
const calculateSizeMatch = (apartmentRooms: string | null | undefined, preferredSize: string | undefined): number => {
  const want = roomsOrdinal(preferredSize);
  const has = roomsOrdinal(apartmentRooms);
  if (want === null || has === null) return 70;
  // "3br+" means 3 or more
  if (String(preferredSize).includes('+') && has >= want) return 100;
  const diff = has - want;
  if (diff === 0) return 100;
  if (diff === 1) return 70;
  if (diff === -1) return 40;
  return 15;
};

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
  location: toStringArray(preferences?.location),
  priceRange: Array.isArray(preferences?.priceRange) && preferences.priceRange.length === 2
    ? preferences.priceRange
    : [0, Number.MAX_SAFE_INTEGER] as [number, number],
});

const getVibeMetrics = (apartment: Apartment) => {
  const vibeAnalysis = (apartment as any).vibe_analysis;
  return vibeAnalysis && typeof vibeAnalysis === 'object' ? vibeAnalysis : null;
};

// Resolve the property's canonical feature set: prefer the stored
// vibe_analysis.features (from analyze-vibe / backfill), else derive on the fly
// so scoring works even before a property has been re-processed.
const getPropertyFeatures = (apartment: Apartment): PropertyFeatures => {
  const va = getVibeMetrics(apartment) || {};
  if (va.features && typeof va.features === 'object') return va.features as PropertyFeatures;
  return extractPropertyFeatures({
    metrics: va,
    amenities: (apartment as any).amenities,
    highlights: (apartment as any).highlights,
    description: (apartment as any).description,
    title: (apartment as any).title,
  });
};

const getRequiredFeatures = (preferences: UserPreferences) => {
  const mustHaves = (preferences?.mustHaves ?? []) as FeatureKey[];
  const soft = lifestyleToSoftFeatures(preferences?.activities);
  return { mustHaves, soft };
};

export interface VibeAttribute {
  label: string;
  matched: boolean;
}

export interface VibeAttributeMatch {
  style: VibeAttribute[];
  /** Quiz lifestyle activities (Working, Cooking, ...) - matched when the
   *  property has the related soft features. Shown in the quiz's own words. */
  lifestyle: VibeAttribute[];
  /** Concrete must-have features only; lifestyle-derived soft features are
   *  represented through the lifestyle group instead. */
  features: FeatureAttribute[];
  hasAny: boolean;
}

// Categorise the property's style + concrete features and flag which align with
// the renter's preferences. Powers the vibe-match popover so renters see WHAT
// matches (must-haves + lifestyle-derived features), not just a percentage.
export const getVibeAttributeMatch = (apartment: Apartment, preferences: UserPreferences): VibeAttributeMatch => {
  const vibeAnalysis = getVibeMetrics(apartment) || {};
  const prefs = normalizePreferencePayload(preferences);

  const userLower = new Set(prefs.styles.map(v => v.toLowerCase()));
  const seen = new Set<string>();
  const style: VibeAttribute[] = [];
  for (const raw of toStringArray(vibeAnalysis.styles)) {
    const key = raw.toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    style.push({ label: raw.trim(), matched: userLower.has(key) });
  }
  style.sort((a, b) => Number(b.matched) - Number(a.matched));

  const { mustHaves } = getRequiredFeatures(preferences);
  const propertyFeatures = getPropertyFeatures(apartment);
  // Features group shows concrete must-haves only; lifestyle soft features
  // surface through the lifestyle group below in the quiz's own words.
  const { attributes: features } = getFeatureMatch(propertyFeatures, mustHaves, []);

  // Lifestyle: each quiz activity is matched when the property has at least
  // half of its related soft features (e.g. Working -> workspace/light/quiet).
  const lifestyle: VibeAttribute[] = toStringArray(preferences?.activities).map((activity) => {
    const mapped = LIFESTYLE_FEATURE_MAP[activity] ?? [];
    const hits = mapped.filter((f) => propertyHasFeature(propertyFeatures, f)).length;
    return { label: activity, matched: mapped.length > 0 && hits >= Math.ceil(mapped.length / 2) };
  });
  lifestyle.sort((a, b) => Number(b.matched) - Number(a.matched));

  return {
    style: style.slice(0, 6),
    lifestyle,
    features,
    hasAny: style.length + lifestyle.length + features.length > 0,
  };
};

// Feature dimension: must-haves dominate; lifestyle-derived soft features nudge.
// Returns a raw 0-100 score and whether a hard must-have is unmet.
const calculateFeatureMatch = (
  apartment: Apartment,
  mustHaves: FeatureKey[],
  soft: FeatureKey[],
): { score: number; missingMustHave: boolean } => {
  const features = getPropertyFeatures(apartment);
  const { missingMustHave, mustMatched } = getFeatureMatch(features, mustHaves, soft);
  const softList = soft.filter(k => !mustHaves.includes(k));
  const softMatched = softList.filter(k => propertyHasFeature(features, k)).length;

  let score: number;
  if (mustHaves.length === 0 && softList.length === 0) {
    score = 70; // renter expressed no feature preference — neutral, non-punishing
  } else if (mustHaves.length > 0) {
    const mustRatio = mustMatched / mustHaves.length;
    const softRatio = softList.length ? softMatched / softList.length : 0;
    score = 100 * (0.8 * mustRatio + 0.2 * softRatio);
  } else {
    const softRatio = softList.length ? softMatched / softList.length : 0;
    score = 55 + 45 * softRatio;
  }
  return { score, missingMustHave };
};

export const calculateVibeScore = (apartment: Apartment, preferences: UserPreferences): VibeScore => {
  const normalizedPreferences = normalizePreferencePayload(preferences);
  const { mustHaves, soft } = getRequiredFeatures(preferences);

  const styleScore = calculateStyleMatch(apartment, normalizedPreferences.styles);
  const locationScore = calculateLocationMatch(apartment.location, normalizedPreferences.location);
  const priceScore = calculatePriceMatch(apartment.price, normalizedPreferences.priceRange);
  const sizeScore = calculateSizeMatch(apartment.rooms, preferences?.size);
  const { score: featureRaw, missingMustHave } = calculateFeatureMatch(apartment, mustHaves, soft);

  // Hard cap: a property missing a deal-breaker can't score well on features.
  const featureScore = missingMustHave ? Math.min(featureRaw, 40) : featureRaw;

  // Every quiz answer feeds a dimension: styles -> style, activities ->
  // lifestyle-derived soft features (inside features), mustHaves -> features,
  // size -> bedroom fit, location and priceRange -> their own dimensions.
  let overall = Math.round(
    styleScore * 0.25 +
    featureScore * 0.30 +
    sizeScore * 0.10 +
    locationScore * 0.20 +
    priceScore * 0.15
  );
  // And its overall grade is capped so a deal-breaker miss can't read "Perfect vibe".
  if (missingMustHave) overall = Math.min(overall, 60);

  return {
    overall,
    missingMustHave,
    breakdown: {
      style: Math.round(styleScore),
      features: Math.round(featureScore),
      price: Math.round(priceScore),
      location: Math.round(locationScore),
      size: Math.round(sizeScore)
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
