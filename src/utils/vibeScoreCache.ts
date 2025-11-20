import { supabase } from '@/integrations/supabase/client';
import { UserPreferences, Apartment } from '@/types';
import { calculateVibeScore, VibeScore } from './vibeScoring';

/**
 * Cache vibe scores in Redis via edge function for faster property discovery
 */

interface CacheVibeScoreParams {
  propertyId: string;
  userId: string;
  preferences: UserPreferences;
  score: VibeScore;
}

interface GetCachedVibeScoreParams {
  propertyId: string;
  userId: string;
  preferencesHash: string;
}

/**
 * Generate a hash from user preferences for cache key
 */
export const hashPreferences = (preferences: UserPreferences): string => {
  const key = JSON.stringify({
    styles: preferences.styles?.sort(),
    colors: preferences.colors?.sort(),
    activities: preferences.activities?.sort(),
    location: preferences.location?.sort(),
    priceRange: preferences.priceRange,
  });
  
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
};

/**
 * Get cached vibe score from Redis, or calculate and cache if not found
 */
export const getCachedVibeScore = async (
  apartment: Apartment,
  preferences: UserPreferences,
  userId: string
): Promise<VibeScore> => {
  try {
    const preferencesHash = hashPreferences(preferences);
    const cacheKey = `vibe_score:${apartment.id}:${userId}:${preferencesHash}`;

    // Try to get from cache via edge function
    const { data: cachedData, error: cacheError } = await supabase.functions.invoke(
      'vibe-score-cache',
      {
        body: {
          action: 'get',
          cacheKey,
        },
      }
    );

    if (!cacheError && cachedData?.score) {
      console.log('[Vibe Score Cache] Cache hit for property:', apartment.id);
      return cachedData.score as VibeScore;
    }

    // Cache miss - calculate score
    console.log('[Vibe Score Cache] Cache miss, calculating for property:', apartment.id);
    const score = calculateVibeScore(apartment, preferences);

    // Cache the result (fire and forget)
    supabase.functions
      .invoke('vibe-score-cache', {
        body: {
          action: 'set',
          cacheKey,
          score,
        },
      })
      .then(({ error }) => {
        if (error) {
          console.error('[Vibe Score Cache] Error caching score:', error);
        } else {
          console.log('[Vibe Score Cache] Cached score for property:', apartment.id);
        }
      });

    return score;
  } catch (error) {
    console.error('[Vibe Score Cache] Error:', error);
    // Fallback to direct calculation
    return calculateVibeScore(apartment, preferences);
  }
};

/**
 * Batch get cached vibe scores for multiple properties
 */
export const batchGetCachedVibeScores = async (
  apartments: Apartment[],
  preferences: UserPreferences,
  userId: string
): Promise<Map<string, VibeScore>> => {
  const scoreMap = new Map<string, VibeScore>();
  
  // Process in parallel for better performance
  await Promise.all(
    apartments.map(async (apartment) => {
      const score = await getCachedVibeScore(apartment, preferences, userId);
      scoreMap.set(apartment.id, score);
    })
  );

  return scoreMap;
};

/**
 * Invalidate cache for a property (useful when property is updated)
 */
export const invalidateVibeScoreCache = async (propertyId: string): Promise<void> => {
  try {
    await supabase.functions.invoke('vibe-score-cache', {
      body: {
        action: 'invalidate',
        propertyId,
      },
    });
    console.log('[Vibe Score Cache] Invalidated cache for property:', propertyId);
  } catch (error) {
    console.error('[Vibe Score Cache] Error invalidating cache:', error);
  }
};
