import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import { Apartment, UserPreferences } from '@/types';
import { EditorialPropertyCard } from '@/components/EditorialPropertyCard';
import { calculateVibeScore, getVibeAttributeMatch } from '@/utils/vibeScoring';
import { ContactModal } from '@/components/ContactModal';
import { RealtorProfileModal } from '@/components/RealtorProfileModal';
import { UserProfile } from '@/components/LoginModal';
import { useMatches } from '@/hooks/useMatches';
import { HaustoChat } from '@/components/HaustoChat';
import { useDirectMessages } from '@/hooks/useDirectMessages';
import { useAuth } from '@/hooks/useAuth';
import { useViewingQuota } from '@/hooks/useViewingQuota';
import { useFastTrackRequest } from '@/hooks/useFastTrackRequest';
import { ViewingScheduleModal, ViewingScheduleData } from '@/components/ViewingScheduleModal';
import { SubscriptionModal } from '@/components/SubscriptionModal';
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
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  // Which listing the renter clicked "Ask" on — passed into HaustoChat so the
  // conversation opens already tagged with that property.
  const [chatPropertyId, setChatPropertyId] = useState<string | null>(null);
  // Fast-Track scheduling: which conversation/realtor the request belongs to,
  // and which property the renter clicked "Viewing" on.
  const [scheduleContext, setScheduleContext] = useState<{ conversationId: string; realtorId: string; propertyId: string } | null>(null);
  const [isSubscriptionModalOpen, setIsSubscriptionModalOpen] = useState(false);
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
  const { quota } = useViewingQuota();
  const { submitFastTrack } = useFastTrackRequest();
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

    // For external properties, open messaging with Hausto Agent
    const isExternal = apartment.realtor.id === HAUSTO_AGENT_ID;
    const realtorId = isExternal ? HAUSTO_AGENT_ID : apartment.realtor.id;

    if (!isExternal) {
      // Check if property is still available (only for internal properties)
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
    }

    // Get or create conversation with the realtor (or Hausto Agent for external)
    const conversationId = await getOrCreateConversation(user.id, realtorId);
    
    if (conversationId) {
      setCurrentConversationId(conversationId);
      setSelectedConversationId(conversationId);
      setChatPropertyId(apartment.id);
      setIsChatOpen(true);
    } else {
      setSelectedApartment(apartment);
    }
  };

  // Primary CTA: Hausto books the viewings (Fast-Track). The first coordination
  // is free; once the allowance is spent, the upgrade modal takes over.
  const handleScheduleViewing = async (apartment: Apartment) => {
    if (!user?.id) {
      setSelectedApartment(apartment);
      return;
    }
    if (!quota) {
      toast.info('Checking your viewing allowance - one moment.');
      return;
    }
    if (!quota.canBook) {
      toast.info(
        quota.trialUsed ? "You've used your free viewing coordination" : 'Viewing bookings used up for this cycle',
        { description: 'Skip the back-and-forth: pick times, and our team coordinates every viewing for you.' },
      );
      setIsSubscriptionModalOpen(true);
      return;
    }
    const isExternal = apartment.realtor.id === HAUSTO_AGENT_ID;
    const realtorId = isExternal ? HAUSTO_AGENT_ID : apartment.realtor.id;
    const conversationId = await getOrCreateConversation(user.id, realtorId);
    if (!conversationId) {
      toast.error('Could not start a viewing request. Please try again.');
      return;
    }
    setScheduleContext({ conversationId, realtorId, propertyId: apartment.id });
  };

  const handleViewingScheduleSubmit = async (scheduleData: ViewingScheduleData) => {
    if (!scheduleContext) return;
    try {
      const realtorApartments = allApartments.filter(a => a.realtor.id === scheduleContext.realtorId);
      await submitFastTrack({
        conversationId: scheduleContext.conversationId,
        realtorId: scheduleContext.realtorId,
        scheduleData,
        properties: realtorApartments.map(a => ({
          id: a.id,
          title: a.title,
          location: a.location,
          price: a.price,
          imageUrl: a.images?.[0] || '',
        })),
      });
      toast.success('Viewing request sent!', {
        description: 'Hausto will coordinate the viewings and get back to you soon.',
      });
      setScheduleContext(null);
    } catch (error) {
      console.error('Error submitting viewing schedule:', error);
      toast.error('Failed to submit viewing request. Please try again.');
    }
  };

  if (isLoadingMatches) {
    return <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full"></div>
      </div>;
  }
  const allApartments = renterMatches?.map(transformMatchToApartment).filter((apt): apt is Apartment => apt !== null) || [];
  if (allApartments.length === 0) {
    return <div className="text-center py-12 animate-fade-in">
        <div className="w-24 h-24 bg-gradient-to-br from-primary to-accent rounded-full flex items-center justify-center mx-auto mb-8 mt-20 shadow-xl animate-float">
          <span className="text-white text-4xl">💕</span>
        </div>
        <h3 className="text-2xl font-serif text-foreground mb-3">No matches yet</h3>
        <p className="text-muted-foreground text-base max-w-sm mx-auto">Start chatting with the AI or swiping to discover your perfect place!</p>
      </div>;
  }
  return <div className="container mx-auto px-4 pt-6 pb-12 animate-fade-in">
      <div className="mb-10 text-center">
        <h2 className="text-2xl font-serif font-normal text-foreground mb-4">Your Matches</h2>
        <div className="inline-block px-4 py-1.5 rounded-full bg-secondary text-secondary-foreground text-sm font-medium border border-border">
          {allApartments.length} {allApartments.length === 1 ? 'property' : 'properties'} saved
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {allApartments.map(apartment => {
        const vibeScore = userPreferences ? calculateVibeScore(apartment, userPreferences) : null;
        const vibeMatch = userPreferences ? getVibeAttributeMatch(apartment, userPreferences) : undefined;
        return <div key={apartment.id} className="relative">
                <EditorialPropertyCard
                  apartment={apartment}
                  vibeScore={vibeScore ? { overall: Number(vibeScore.overall), breakdown: vibeScore.breakdown } : undefined}
                  vibeMatch={vibeMatch}
                  topRightActions={apartment.matchId ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="icon"
                          variant="secondary"
                          aria-label="Remove from matches"
                          className="w-8 h-8 rounded-full border-0 backdrop-blur-md transition-all bg-white/20 text-white hover:bg-red-500/80"
                          disabled={isRemovingMatch}
                          onClick={e => e.stopPropagation()}
                        >
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
                  ) : undefined}
                />
            </div>;
      })}
      </div>

      {selectedApartment && <ContactModal apartment={selectedApartment} onClose={() => setSelectedApartment(null)} userProfile={userProfile} />}

      {selectedRealtorId && <RealtorProfileModal realtorId={selectedRealtorId} isOpen={!!selectedRealtorId} onClose={() => setSelectedRealtorId(null)} />}

      <HaustoChat isOpen={isChatOpen} onClose={() => {
      setIsChatOpen(false);
      setSelectedConversationId(null);
      setChatPropertyId(null);
    }} userPreferences={userPreferences} userType="renter" initialMatchId={selectedConversationId} initialPropertyId={chatPropertyId} />

      <ViewingScheduleModal
        isOpen={!!scheduleContext}
        onClose={() => setScheduleContext(null)}
        onSubmit={handleViewingScheduleSubmit}
        matchedProperties={allApartments
          .filter(a => !scheduleContext || a.realtor.id === scheduleContext.realtorId)
          .map(a => ({
            id: a.id,
            title: a.title,
            images: a.images,
            location: a.location,
            price: a.price,
          }))}
        initialSelectedIds={scheduleContext ? [scheduleContext.propertyId] : []}
      />

      <SubscriptionModal
        isOpen={isSubscriptionModalOpen}
        onClose={() => setIsSubscriptionModalOpen(false)}
        reason={quota?.trialUsed ? 'viewings' : undefined}
      />
    </div>;
};