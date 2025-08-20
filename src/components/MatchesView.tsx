import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Trash2, MessageCircle } from 'lucide-react';
import { Apartment, UserPreferences } from '@/pages/Index';
import { PropertyCard } from '@/components/PropertyCard';
import { ContactModal } from '@/components/ContactModal';
import { RealtorProfileModal } from '@/components/RealtorProfileModal';
import { PropertyDetailModal } from '@/components/PropertyDetailModal';
import { UserProfile } from '@/components/LoginModal';
import { useMatches } from '@/hooks/useMatches';
import { AIChatAgent } from '@/components/AIChatAgent';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface MatchesViewProps {
  userPreferences?: UserPreferences;
  userProfile?: UserProfile;
}

export const MatchesView = ({ userPreferences, userProfile }: MatchesViewProps) => {
  const [selectedApartment, setSelectedApartment] = useState<Apartment | null>(null);
  const [selectedRealtorId, setSelectedRealtorId] = useState<string | null>(null);
  const [detailModalApartment, setDetailModalApartment] = useState<Apartment | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const { renterMatches, isLoadingMatches, removeMatch, isRemovingMatch } = useMatches();

  const transformMatchToApartment = (match: any): Apartment => {
    const rawVA = match.properties?.vibe_analysis;
    let parsedVA = rawVA;
    if (rawVA && typeof rawVA === 'string') {
      try { parsedVA = JSON.parse(rawVA); } catch { parsedVA = null; }
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

  if (isLoadingMatches) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full"></div>
      </div>
    );
  }

  const apartments = renterMatches?.map(transformMatchToApartment) || [];

  if (apartments.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-24 h-24 bg-primary rounded-full flex items-center justify-center mx-auto mb-6">
          <span className="text-white text-3xl">💕</span>
        </div>
        <h3 className="text-xl font-semibold text-foreground mb-2">No matches yet</h3>
        <p className="text-muted-foreground mb-6">Start swiping to find your perfect place!</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 pt-20">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-foreground mb-2">Your Matches</h2>
        <p className="text-muted-foreground">Properties that match your preferences</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {apartments.map((apartment) => {
          return (
            <div key={apartment.id} className="relative">
                <PropertyCard
                  apartment={apartment}
                  userPreferences={userPreferences}
                  onViewProfile={() => setSelectedRealtorId(apartment.realtor.id)}
                  onContact={() => {
                    setSelectedMatchId(apartment.matchId!);
                    setIsChatOpen(true);
                  }}
                  showContactButton={true}
                  showViewProfileButton={true}
                  showFullTitle={true}
                  showFullDescription={false}
                  showAllHighlights={true}
                  className="sm:h-auto"
                />
              {apartment.matchId && (
                <div className="absolute top-4 right-4">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button 
                        size="sm" 
                        variant="outline"
                        className="text-destructive hover:text-destructive/80 hover:bg-destructive/10 w-8 h-8 p-0 bg-card/90 backdrop-blur-sm"
                        disabled={isRemovingMatch}
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
                        <AlertDialogAction 
                          onClick={() => handleRemoveMatch(apartment.matchId!)}
                          className="bg-destructive hover:bg-destructive/90"
                        >
                          Remove
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {selectedApartment && (
        <ContactModal
          apartment={selectedApartment}
          onClose={() => setSelectedApartment(null)}
          userProfile={userProfile}
        />
      )}

      {selectedRealtorId && (
        <RealtorProfileModal
          realtorId={selectedRealtorId}
          isOpen={!!selectedRealtorId}
          onClose={() => setSelectedRealtorId(null)}
        />
      )}

      {detailModalApartment && (
        <PropertyDetailModal
          apartment={detailModalApartment}
          isOpen={!!detailModalApartment}
          onClose={() => setDetailModalApartment(null)}
          userPreferences={userPreferences}
        />
      )}

      <AIChatAgent
        isOpen={isChatOpen}
        onClose={() => {
          setIsChatOpen(false);
          setSelectedMatchId(null);
        }}
        userPreferences={userPreferences}
        userType="renter"
        initialMatchId={selectedMatchId}
      />
    </div>
  );
};