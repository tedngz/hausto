import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import { Apartment, UserPreferences } from '@/types';
import { EditorialPropertyCard } from '@/components/EditorialPropertyCard';
import { calculateVibeScore, getVibeAttributeMatch } from '@/utils/vibeScoring';
import { RealtorProfileModal } from '@/components/RealtorProfileModal';
import { UserProfile } from '@/components/LoginModal';
import { useMatches } from '@/hooks/useMatches';
import { useAuth } from '@/hooks/useAuth';
import { RequestViewingModal } from '@/components/RequestViewingModal';
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
  const [selectedRealtorId, setSelectedRealtorId] = useState<string | null>(null);
  // Fast-Track scheduling: which conversation/realtor the request belongs to,
  // and which property the renter clicked "Viewing" on.
  /** The match a viewing is being requested for (invariant 8: one way to ask). */
  const [requestFor, setRequestFor] = useState<Apartment | null>(null);
  const {
    renterMatches,
    isLoadingMatches,
    removeMatch,
    isRemovingMatch
  } = useMatches();
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

  // Primary CTA: the request modal, which says itself whether this takes the
  // Pass (requestGate, SPEC §9), so there is nothing to check before it opens.
  const handleScheduleViewing = (apartment: Apartment) => {
    if (!user?.id) {
      toast.info('Please sign in to request a viewing.');
      return;
    }
    setRequestFor(apartment);
  };

  if (isLoadingMatches) {
    return <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full"></div>
      </div>;
  }
  const allApartments = renterMatches?.map(transformMatchToApartment).filter((apt): apt is Apartment => apt !== null) || [];
  // Which ledger each match came from. The read is stored per listing and the
  // two id spaces are separate, so the card alone can't say which to ask for -
  // Apartment doesn't carry the type, the match row does.
  const externalIds = new Set(
    (renterMatches ?? [])
      .filter((m: any) => m.property_type === 'external')
      .map((m: any) => m.properties?.id)
      .filter(Boolean),
  );
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
                  propertyType={externalIds.has(apartment.id) ? 'external' : 'internal'}
                  vibeScore={vibeScore ? { overall: Number(vibeScore.overall), breakdown: vibeScore.breakdown } : undefined}
                  vibeMatch={vibeMatch}
                  onSchedule={() => handleScheduleViewing(apartment)}
                  scheduleLabel="Request viewing"
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


      {selectedRealtorId && <RealtorProfileModal realtorId={selectedRealtorId} isOpen={!!selectedRealtorId} onClose={() => setSelectedRealtorId(null)} />}


      <RequestViewingModal
        open={!!requestFor}
        onOpenChange={o => { if (!o) setRequestFor(null); }}
        seed={requestFor ? { listingId: requestFor.id, title: requestFor.title, imageUrl: requestFor.images?.[0] ?? null } : null}
      />
    </div>;
};