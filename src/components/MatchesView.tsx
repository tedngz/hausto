import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Trash2, MessageCircle, Sparkles } from 'lucide-react';
import { Apartment, UserPreferences } from '@/types';
import { PropertyCard } from '@/components/PropertyCard';
import { ContactModal } from '@/components/ContactModal';
import { RealtorProfileModal } from '@/components/RealtorProfileModal';
import { PropertyDetailModal } from '@/components/PropertyDetailModal';
import { UserProfile } from '@/components/LoginModal';
import { useMatches } from '@/hooks/useMatches';
import { HaustoChat } from '@/components/HaustoChat';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Badge } from '@/components/ui/badge';
interface MatchesViewProps {
  userPreferences?: UserPreferences;
  userProfile?: UserProfile;
}
export const MatchesView = ({
  userPreferences,
  userProfile
}: MatchesViewProps) => {
  const { user } = useAuth();
  const [selectedApartment, setSelectedApartment] = useState<Apartment | null>(null);
  const [selectedRealtorId, setSelectedRealtorId] = useState<string | null>(null);
  const [detailModalApartment, setDetailModalApartment] = useState<Apartment | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [aiProperties, setAiProperties] = useState<Apartment[]>([]);
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  
  const {
    renterMatches,
    isLoadingMatches,
    removeMatch,
    isRemovingMatch
  } = useMatches();

  // Fetch AI search results
  useEffect(() => {
    const fetchAISearchResults = async () => {
      if (!user?.id) return;
      
      setIsLoadingAI(true);
      try {
        // Get all AI searches for the user
        const { data: searches, error: searchError } = await supabase
          .from('ai_searches')
          .select('id')
          .eq('user_id', user.id);

        if (searchError || !searches?.length) {
          setIsLoadingAI(false);
          return;
        }

        const searchIds = searches.map(s => s.id);

        // Get all search results
        const { data: results, error: resultsError } = await supabase
          .from('ai_search_results')
          .select('property_id, match_score, match_reason')
          .in('search_id', searchIds);

        if (resultsError || !results?.length) {
          setIsLoadingAI(false);
          return;
        }

        // Get unique property IDs
        const uniquePropertyIds = [...new Set(results.map(r => r.property_id))];

        // Fetch property details
        const { data: properties, error: propError } = await supabase
          .from('properties')
          .select('*')
          .in('id', uniquePropertyIds);

        if (propError || !properties) {
          setIsLoadingAI(false);
          return;
        }

        // Get realtor names
        const realtorIds = [...new Set(properties.map(p => p.realtor_id))];
        const { data: realtorProfiles } = await supabase
          .rpc('get_matched_public_profiles', { user_ids: realtorIds });

        // Transform to Apartment format
        const aiApartments: Apartment[] = properties.map(prop => {
          const result = results.find(r => r.property_id === prop.id);
          const realtorProfile = realtorProfiles?.find((r: any) => r.id === prop.realtor_id);
          
          let parsedVA = prop.vibe_analysis;
          if (parsedVA && typeof parsedVA === 'string') {
            try {
              parsedVA = JSON.parse(parsedVA);
            } catch {
              parsedVA = null;
            }
          }

          return {
            id: prop.id,
            images: prop.images || [],
            title: prop.title,
            location: prop.location,
            price: Number(prop.price),
            size: prop.size || '',
            vibe: prop.vibe || '',
            description: prop.description || '',
            highlights: prop.highlights || [],
            vibe_analysis: parsedVA,
            property_source_link: prop.property_source_link,
            realtor: {
              id: prop.realtor_id,
              name: realtorProfile?.name || 'Property Owner',
              phone: '+1-234-567-8900',
              email: 'contact@realtor.com'
            }
          };
        });

        setAiProperties(aiApartments);
      } catch (error) {
        console.error('Error fetching AI search results:', error);
      } finally {
        setIsLoadingAI(false);
      }
    };

    fetchAISearchResults();
  }, [user?.id]);
  const transformMatchToApartment = (match: any): Apartment => {
    const rawVA = match.properties?.vibe_analysis;
    let parsedVA = rawVA;
    if (rawVA && typeof rawVA === 'string') {
      try {
        parsedVA = JSON.parse(rawVA);
      } catch {
        parsedVA = null;
      }
    }
    return {
      id: match.properties.id,
      images: match.properties.images || [],
      title: match.properties.title,
      location: match.properties.location,
      price: Number(match.properties.price),
      size: match.properties.size || '',
      vibe: match.properties.vibe || '',
      description: match.properties.description || '',
      highlights: match.properties.highlights || [],
      vibe_analysis: parsedVA,
      property_source_link: match.properties.property_source_link,
      realtor: {
        id: match.properties.realtor_id || '',
        name: match.realtor_name || 'Property Owner',
        phone: '+1-234-567-8900',
        email: 'contact@realtor.com'
      },
      matchId: match.id
    };
  };
  const handleRemoveMatch = async (matchId: string) => {
    await removeMatch(matchId);
  };
  if (isLoadingMatches || isLoadingAI) {
    return <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full"></div>
      </div>;
  }
  
  const regularApartments = renterMatches?.map(transformMatchToApartment) || [];
  
  // Filter out AI properties that are already in regular matches
  const regularPropertyIds = new Set(regularApartments.map(a => a.id));
  const uniqueAiProperties = aiProperties.filter(p => !regularPropertyIds.has(p.id));
  
  const allApartments = [...regularApartments, ...uniqueAiProperties];
  
  if (allApartments.length === 0) {
    return <div className="text-center py-12">
        <div className="w-24 h-24 bg-gradient-to-r from-orange-400 to-red-400 rounded-full flex items-center justify-center mx-auto mb-6 mt-20">
          <span className="text-white text-3xl">💕</span>
        </div>
        <h3 className="text-xl font-semibold text-gray-900 mb-2">No matches yet</h3>
        <p className="text-gray-600 mb-6">Start swiping to find your perfect place!</p>
      </div>;
  }
  return <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold mt-8 mb-2 text-center text-inherit">Your Matches</h2>
        <p className="text-center text-muted-foreground text-sm">
          {regularApartments.length} swipe matches {uniqueAiProperties.length > 0 && `• ${uniqueAiProperties.length} AI discoveries`}
        </p>
      </div>

      <div className="columns-1 md:columns-2 lg:columns-3 gap-6">
        {allApartments.map(apartment => {
          const isAIMatch = !regularPropertyIds.has(apartment.id);
        return <div key={apartment.id} className="relative mb-6 break-inside-avoid">
                {isAIMatch && (
                  <Badge className="absolute top-4 left-4 z-10 bg-gradient-to-r from-purple-500 to-pink-500 text-white border-0">
                    <Sparkles className="w-3 h-3 mr-1" />
                    AI Match
                  </Badge>
                )}
                <PropertyCard apartment={apartment} userPreferences={userPreferences} onContact={() => {
            setSelectedMatchId(apartment.matchId!);
            setIsChatOpen(true);
          }} showContactButton={true} showViewProfileButton={false} showFullTitle={true} showFullDescription={false} showAllHighlights={true} className="sm:h-auto" />
              {apartment.matchId && <div className="absolute top-4 right-4">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="outline" className="text-red-600 hover:text-red-800 hover:bg-red-50 w-8 h-8 p-0 bg-white/90 backdrop-blur-sm" disabled={isRemovingMatch}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove from matches?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will remove "{apartment.title}" from your matches. You can always find it again by swiping.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleRemoveMatch(apartment.matchId!)} className="bg-red-600 hover:bg-red-700">
                          Remove
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>}
            </div>;
      })}
      </div>

      {selectedApartment && <ContactModal apartment={selectedApartment} onClose={() => setSelectedApartment(null)} userProfile={userProfile} />}

      {selectedRealtorId && <RealtorProfileModal realtorId={selectedRealtorId} isOpen={!!selectedRealtorId} onClose={() => setSelectedRealtorId(null)} />}

      {detailModalApartment && <PropertyDetailModal apartment={detailModalApartment} isOpen={!!detailModalApartment} onClose={() => setDetailModalApartment(null)} userPreferences={userPreferences} />}

      <HaustoChat isOpen={isChatOpen} onClose={() => {
      setIsChatOpen(false);
      setSelectedMatchId(null);
    }} userPreferences={userPreferences} userType="renter" initialMatchId={selectedMatchId} />
    </div>;
};