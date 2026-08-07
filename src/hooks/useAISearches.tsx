import { useQuery } from '@tanstack/react-query';
import { PROPERTY_PUBLIC_COLUMNS } from '@/lib/propertyColumns';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface AISearchResult {
  id: string;
  property_id: string;
  match_score: number;
  match_reason: string;
  created_at: string;
}

interface AISearch {
  id: string;
  conversation_id: string;
  query: string;
  summary: string | null;
  total_matches: number;
  created_at: string;
  updated_at: string;
  results: AISearchResult[];
}

interface PropertyMatch {
  id: string;
  title: string;
  location: string;
  price: number;
  size: string;
  vibe: string;
  description: string;
  highlights: string[];
  images: string[];
  matchScore: number;
  matchReason: string;
  realtor_id?: string;
  vibe_analysis?: any;
}

export const useAISearches = (conversationId?: string) => {
  const { user } = useAuth();

  // Fetch AI searches for a specific conversation
  const { data: aiSearches = [], isLoading } = useQuery({
    queryKey: ['ai-searches', user?.id, conversationId],
    queryFn: async () => {
      if (!user?.id || !conversationId) return [];
      
      const { data, error } = await supabase
        .from('ai_searches')
        .select(`
          *,
          results:ai_search_results(*)
        `)
        .eq('conversation_id', conversationId)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as AISearch[];
    },
    enabled: !!user?.id && !!conversationId,
  });

  // Get enriched search results with full property data
  const getEnrichedResults = async (searchId: string): Promise<PropertyMatch[]> => {
    if (!user?.id) return [];

    // First get the search results
    const { data: searchResults, error: resultsError } = await supabase
      .from('ai_search_results')
      .select('*')
      .eq('search_id', searchId);

    if (resultsError || !searchResults) {
      console.error('Error fetching search results:', resultsError);
      return [];
    }

    if (searchResults.length === 0) return [];

    // Get the property IDs
    const propertyIds = searchResults.map(result => result.property_id);

    // Fetch from both internal and external properties in parallel
    const [internalResult, externalResult] = await Promise.all([
      supabase.from('properties').select(PROPERTY_PUBLIC_COLUMNS).in('id', propertyIds),
      supabase.from('external_properties').select('id, title, location, price, size, vibe, description, highlights, images, source, vibe_analysis').in('id', propertyIds),
    ]);

    const internalProperties = internalResult.data || [];
    const externalProperties = externalResult.data || [];

    // Build a combined map
    const propertyMap = new Map<string, any>();
    for (const p of internalProperties) {
      propertyMap.set(p.id, { ...p, _isExternal: false });
    }
    for (const ext of externalProperties) {
      propertyMap.set(ext.id, {
        id: ext.id,
        title: ext.title,
        location: ext.location,
        price: Number(ext.price) || 0,
        size: ext.size || '',
        vibe: ext.vibe || '',
        description: ext.description || '',
        highlights: ext.highlights || [],
        images: ext.images || [],
        realtor_id: `ext-${ext.source}`,
        vibe_analysis: ext.vibe_analysis,
        _isExternal: true,
      });
    }

    // Combine property data with match scores and reasons
    return propertyIds
      .map(pid => {
        const property = propertyMap.get(pid);
        if (!property) return null;
        const searchResult = searchResults.find(r => r.property_id === pid);
        return {
          id: property.id,
          title: property.title,
          location: property.location,
          price: property.price,
          size: property.size || '',
          vibe: property.vibe || '',
          description: property.description || '',
          highlights: property.highlights || [],
          images: property.images || [],
          matchScore: searchResult?.match_score || 0,
          matchReason: searchResult?.match_reason || '',
          realtor_id: property.realtor_id,
          vibe_analysis: property.vibe_analysis
        };
      })
      .filter(Boolean) as PropertyMatch[];
  };

  return {
    aiSearches,
    isLoading,
    getEnrichedResults
  };
};