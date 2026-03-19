import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import { Apartment, UserPreferences } from '@/types';
import { PropertyCard } from '@/components/PropertyCard';
import { ContactModal } from '@/components/ContactModal';
import { RealtorProfileModal } from '@/components/RealtorProfileModal';
import { PropertyDetailModal } from '@/components/PropertyDetailModal';
import { UserProfile } from '@/components/LoginModal';
import { useMatches } from '@/hooks/useMatches';
import { HaustoChat } from '@/components/HaustoChat';
import { useDirectMessages } from '@/hooks/useDirectMessages';
import { useAuth } from '@/hooks/useAuth';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { HAUSTO_AGENT_ID, HAUSTO_AGENT_NAME } from '@/constants/haustoAgent';
interface MatchesViewProps {
  userPreferences?: UserPreferences;
  userProfile?: UserProfile;
}
export const MatchesView = ({
  userPreferences,
  userProfile
}: MatchesViewProps) => {
  const [selectedApartment, setSelectedApartment] = useState<Apartment | null>(null);
  const [selectedRealtorId, setSelectedRealtorId] = useState<string | null>(null);
  const [detailModalApartment, setDetailModalApartment] = useState<Apartment | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const {
    renterMatches,
    isLoadingMatches,
    removeMatch,
    isRemovingMatch
  } = useMatches();
  const {
    conversations,
    getOrCreateConversation,
    setCurrentConversationId
  } = useDirectMessages();
  const { user } = useAuth();
  const transformMatchToApartment = (match: any): Apartment | null => {
    // Filter out matches with null/undefined properties
    if (!match.properties) {
      return null;
    }
    
    const rawVA = match.properties.vibe_analysis;
    let parsedVA = rawVA;
    if (rawVA && typeof rawVA === 'string') {
      try {
        parsedVA = JSON.parse(rawVA);
      } catch {
        parsedVA = null;
      }
    }

    const isExternal = match.property_type === 'external';
    
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
      amenities: match.properties.amenities || [],
      vibe_analysis: parsedVA,
      property_source_link: match.properties.property_source_link || match.properties.source_url,
      property_source_provider_name: match.properties.property_source_provider_name || match.properties.contact_name,
      property_source_provider_phone: match.properties.property_source_provider_phone || match.properties.contact_phone,
      realtor: {
        id: isExternal ? HAUSTO_AGENT_ID : (match.properties.realtor_id || match.realtor_id || ''),
        name: isExternal ? HAUSTO_AGENT_NAME : (match.realtor_name || 'Property Owner'),
        phone: isExternal ? '' : '+1-234-567-8900',
        email: isExternal ? '' : 'contact@realtor.com',
        avatar: isExternal ? '' : (match.realtor_avatar || '')
      },
      matchId: match.id
    };
  };
  const handleRemoveMatch = async (matchId: string) => {
    await removeMatch(matchId);
  };

  const handleContactRealtor = async (apartment: Apartment) => {
    if (!user?.id) {
      setSelectedApartment(apartment);
      return;
    }

    // For external properties, open the source link
    if (apartment.property_source_link && apartment.realtor.id.startsWith('ext-')) {
      window.open(apartment.property_source_link, '_blank');
      return;
    }

    // Check if property is still available
    const { data: property, error } = await supabase
      .from('properties')
      .select('id, is_active')
      .eq('id', apartment.id)
      .maybeSingle();

    if (error || !property || !property.is_active) {
      toast.info("Property No Longer Available", {
        description: "This property is no longer listed. It may have been rented or removed by the owner."
      });
      return;
    }

    // Get or create conversation with this realtor
    const conversationId = await getOrCreateConversation(user.id, apartment.realtor.id);
    
    if (conversationId) {
      setCurrentConversationId(conversationId);
      setSelectedConversationId(conversationId);
      setIsChatOpen(true);
    } else {
      setSelectedApartment(apartment);
    }
  };
  if (isLoadingMatches) {
    return <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full"></div>
      </div>;
  }
  const allApartments = renterMatches?.map(transformMatchToApartment).filter((apt): apt is Apartment => apt !== null) || [];
  if (allApartments.length === 0) {
    return <div className="text-center py-12">
        <div className="w-24 h-24 bg-gradient-to-r from-orange-400 to-red-400 rounded-full flex items-center justify-center mx-auto mb-6 mt-20">
          <span className="text-white text-3xl">💕</span>
        </div>
        <h3 className="text-xl font-semibold text-gray-900 mb-2">No matches yet</h3>
        <p className="text-gray-600 mb-6">Start swiping to find your perfect place!</p>
      </div>;
  }
  return <div className="container mx-auto px-4 pt-4 pb-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold mt-4 mb-2 text-center text-inherit">Your Matches</h2>
        <p className="text-center text-muted-foreground text-sm">
          {allApartments.length} properties matched
        </p>
      </div>

      <div className="columns-1 md:columns-2 lg:columns-3 gap-6">
        {allApartments.map(apartment => {
        return <div key={apartment.id} className="relative mb-6 break-inside-avoid">
                <PropertyCard apartment={apartment} userPreferences={userPreferences} onContact={() => handleContactRealtor(apartment)} showContactButton={true} showFullTitle={true} showFullDescription={false} showAllHighlights={true} className="sm:h-auto" hasDeleteButton={true} />
              {apartment.matchId && <div className="absolute top-3 right-3">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="outline" className="text-red-600 hover:text-red-800 hover:bg-red-50 w-8 h-8 p-0 bg-white/90 backdrop-blur-sm shadow-md" disabled={isRemovingMatch}>
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
      setSelectedConversationId(null);
    }} userPreferences={userPreferences} userType="renter" initialMatchId={selectedConversationId} />
    </div>;
};