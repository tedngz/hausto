import { Apartment, UserPreferences } from '@/types';
import { calculateVibeScore } from './vibeScoring';
import { supabase } from '@/integrations/supabase/client';

interface PropertyWithMetadata extends Apartment {
  created_at?: string;
  last_activated_at?: string;
}

interface ScoredProperty {
  property: Apartment;
  discoveryScore: number;
  recencyScore: number;
  urgencyScore: number;
  matchScore: number;
  randomFactor: number;
}

/**
 * Calculate days since property was created or last activated
 */
const calculateDaysSince = (dateString?: string): number => {
  if (!dateString) return 999; // Old properties get high number
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - date.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
};

/**
 * Calculate days until property becomes inactive (30 days from last_activated_at)
 */
const calculateDaysUntilInactive = (lastActivatedAt?: string): number => {
  if (!lastActivatedAt) return 30; // Assume full period if unknown
  const activated = new Date(lastActivatedAt);
  const expirationDate = new Date(activated);
  expirationDate.setDate(expirationDate.getDate() + 30);
  
  const now = new Date();
  const diffTime = expirationDate.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
};

/**
 * Calculate recency score (0-100)
 * Newer properties get higher scores
 */
const calculateRecencyScore = (daysSince: number): number => {
  if (daysSince <= 1) return 100; // Brand new
  if (daysSince <= 3) return 90;  // Very recent
  if (daysSince <= 7) return 75;  // Recent
  if (daysSince <= 14) return 60; // Moderately recent
  if (daysSince <= 30) return 40; // Getting old
  return 20; // Old
};

/**
 * Calculate urgency score (0-100)
 * Properties closer to expiration get urgency boost
 */
const calculateUrgencyScore = (daysUntilInactive: number): number => {
  if (daysUntilInactive <= 3) return 100; // Critical - expiring soon!
  if (daysUntilInactive <= 7) return 85;  // High urgency
  if (daysUntilInactive <= 14) return 60; // Moderate urgency
  if (daysUntilInactive <= 21) return 30; // Low urgency
  return 10; // Plenty of time left
};

/**
 * Strategically sort properties for discovery
 * Balances recency, urgency, match quality, and randomization
 * NOW WITH VECTOR SEARCH for semantic matching!
 */
export const sortPropertiesForDiscovery = async (
  properties: Apartment[],
  userPreferences: UserPreferences | null
): Promise<Apartment[]> => {
  if (properties.length === 0) return [];

  // Try vector search for semantic filtering if preferences exist
  let filteredProperties = properties;
  
  if (userPreferences) {
    try {
      console.log('[Property Discovery] Using vector search for semantic matching');
      
      const { data, error } = await supabase.functions.invoke('vector-property-search', {
        body: {
          preferences: userPreferences,
          topK: Math.min(properties.length, 100), // Get more candidates for better results
          filters: {
            priceMin: userPreferences.priceRange?.[0],
            priceMax: userPreferences.priceRange?.[1],
            location: userPreferences.location,
            styles: userPreferences.styles,
          }
        }
      });

      if (!error && data?.results && data.results.length > 0) {
        // Map vector search results back to property objects
        const vectorScoredPropertyIds = new Set(data.results.map((r: any) => r.id));
        filteredProperties = properties.filter(p => vectorScoredPropertyIds.has(p.id));
        console.log(`[Property Discovery] Vector search filtered to ${filteredProperties.length} properties`);
      } else {
        console.log('[Property Discovery] Vector search returned no results, using all properties');
      }
    } catch (err) {
      console.error('[Property Discovery] Vector search error, falling back to traditional scoring:', err);
      // Fallback: use all properties
    }
  }
  
  // Score each property (now from filtered set)
  const scoredProperties: ScoredProperty[] = filteredProperties.map(property => {
    const propertyWithMeta = property as PropertyWithMetadata;
    
    // Calculate individual scores
    const daysSince = calculateDaysSince(propertyWithMeta.created_at || propertyWithMeta.last_activated_at);
    const daysUntilInactive = calculateDaysUntilInactive(propertyWithMeta.last_activated_at);
    
    const recencyScore = calculateRecencyScore(daysSince);
    const urgencyScore = calculateUrgencyScore(daysUntilInactive);
    
    // Calculate match score if preferences exist
    const matchScore = userPreferences 
      ? calculateVibeScore(property, userPreferences).overall 
      : 50; // Neutral score if no preferences
    
    // Random factor for excitement and variety (0-100)
    const randomFactor = Math.random() * 100;
    
    // Calculate weighted discovery score
    // Weights: Match quality (40%), Recency (25%), Urgency (20%), Random (15%)
    const discoveryScore = 
      (matchScore * 0.40) +
      (recencyScore * 0.25) +
      (urgencyScore * 0.20) +
      (randomFactor * 0.15);
    
    return {
      property,
      discoveryScore,
      recencyScore,
      urgencyScore,
      matchScore,
      randomFactor
    };
  });
  
  // Sort by discovery score (highest first)
  scoredProperties.sort((a, b) => b.discoveryScore - a.discoveryScore);
  
  // Strategic shuffling: Group into tiers and shuffle within tiers
  // This prevents perfect sorting while maintaining quality distribution
  const tiers: ScoredProperty[][] = [[], [], []];
  
  scoredProperties.forEach((scored, index) => {
    if (index < scoredProperties.length * 0.33) {
      tiers[0].push(scored); // Top tier (high scores)
    } else if (index < scoredProperties.length * 0.66) {
      tiers[1].push(scored); // Middle tier
    } else {
      tiers[2].push(scored); // Lower tier
    }
  });
  
  // Shuffle within each tier for variety
  const shuffleTier = (tier: ScoredProperty[]) => {
    for (let i = tier.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tier[i], tier[j]] = [tier[j], tier[i]];
    }
    return tier;
  };
  
  const shuffledTiers = tiers.map(shuffleTier);
  
  // Occasionally promote properties from lower tiers (10% chance each)
  // This ensures even lower-scored properties get seen sometimes
  const finalOrder: ScoredProperty[] = [];
  let tierIndex = 0;
  
  while (shuffledTiers.some(tier => tier.length > 0)) {
    // Mostly pick from top tier, but sometimes dip into lower tiers
    const roll = Math.random();
    let selectedTier;
    
    if (roll < 0.70 && shuffledTiers[0].length > 0) {
      selectedTier = 0; // 70% from top tier
    } else if (roll < 0.90 && shuffledTiers[1].length > 0) {
      selectedTier = 1; // 20% from middle tier
    } else if (shuffledTiers[2].length > 0) {
      selectedTier = 2; // 10% from lower tier
    } else {
      // Fallback to first non-empty tier
      selectedTier = shuffledTiers.findIndex(tier => tier.length > 0);
    }
    
    if (selectedTier >= 0) {
      const property = shuffledTiers[selectedTier].shift();
      if (property) finalOrder.push(property);
    }
  }
  
  // Return just the properties in the new order
  return finalOrder.map(scored => scored.property);
};
