import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { PropertyListingCard } from '@/components/PropertyListingCard';
import { ListingHistoryNote } from '@/components/ListingHistoryNote';
import { HaustoChat } from '@/components/HaustoChat';
import { RealtorProfileModal } from '@/components/RealtorProfileModal';
import { useMatches } from '@/hooks/useMatches';
import { useViewingQuota } from '@/hooks/useViewingQuota';
import { useFastTrackRequest } from '@/hooks/useFastTrackRequest';
import { ViewingScheduleModal, ViewingScheduleData } from '@/components/ViewingScheduleModal';
import { SubscriptionModal } from '@/components/SubscriptionModal';
import { useDirectMessages } from '@/hooks/useDirectMessages';
import { HAUSTO_AGENT_ID } from '@/constants/haustoAgent';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { CurrencyDropdown } from '@/components/CurrencyDropdown';
import { shareProperty } from '@/utils/shareProperty';
import { ArrowLeft, Loader2, LogIn, Share2 } from 'lucide-react';
import { Apartment, UserPreferences } from '@/types';
import { CurrencyProvider } from '@/contexts/CurrencyContext';
import { Card, CardContent } from '@/components/ui/card';
import { dbToPreferences, hasMeaningfulPreferences } from '@/lib/preferences';
import { calculateVibeScore, getVibeAttributeMatch } from '@/utils/vibeScoring';

const PropertyDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [apartment, setApartment] = useState<Apartment | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRealtorProfile, setShowRealtorProfile] = useState(false);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [source, setSource] = useState<'internal' | 'external'>('internal');
  const [isRelist, setIsRelist] = useState(false);
  const [firstSeenAt, setFirstSeenAt] = useState<string | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatConversationId, setChatConversationId] = useState<string | null>(null);
  const [isBooking, setIsBooking] = useState(false);
  // Set once the listing has a conversation to hang the request off; opening
  // the schedule modal is what it gates.
  const [scheduleContext, setScheduleContext] = useState<{ conversationId: string; realtorId: string } | null>(null);
  const [isSubscriptionOpen, setIsSubscriptionOpen] = useState(false);
  const { createMatch } = useMatches();
  const { quota } = useViewingQuota();
  const { submitFastTrack } = useFastTrackRequest();
  const { getOrCreateConversation } = useDirectMessages();

  // Signed-in renters see how the listing matches their saved preferences
  // instead of the property's generic style badge. localStorage first for an
  // instant read, then reconcile with the DB so it works on a fresh device.
  useEffect(() => {
    if (!user) {
      setPreferences(null);
      return;
    }
    const cached = localStorage.getItem(`userPreferences_${user.id}`);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as UserPreferences;
        if (hasMeaningfulPreferences(parsed)) setPreferences(parsed);
      } catch {
        // ignore malformed cache and fall through to the DB read
      }
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      const dbPrefs = dbToPreferences(data as any);
      if (!cancelled && dbPrefs && hasMeaningfulPreferences(dbPrefs)) setPreferences(dbPrefs);
    })();
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    const fetchProperty = async () => {
      if (!id) return;

      try {
        const { data, error } = await supabase.functions.invoke('get-public-property', {
          body: { id },
        });

        if (error || !data || data.error) {
          setLoading(false);
          return;
        }

        setSource(data.source === 'external' ? 'external' : 'internal');

        if (data.source === 'internal') {
          const property = data.property;
          const realtor = data.realtor;
          const transformedApartment: Apartment = {
            id: property.id,
            images: property.images || [],
            title: property.title,
            location: property.location,
            price: Number(property.price || 0),
            size: property.size || '',
            vibe: property.vibe || '',
            description: property.description || '',
            highlights: property.highlights || [],
            amenities: property.amenities || [],
            vibe_analysis: property.vibe_analysis,
            property_source_link: property.property_source_link,
            property_source_provider_name: property.property_source_provider_name || undefined,
            property_source_provider_phone: property.property_source_provider_phone || undefined,
            rooms: property.rooms || null,
            realtor: realtor ? {
              id: realtor.id,
              name: realtor.name || 'Property Owner',
              phone: realtor.phone || '',
              email: realtor.email || '',
              avatar: realtor.avatar_url,
            } : {
              id: property.realtor_id,
              name: 'Property Owner',
              phone: '',
              email: '',
              avatar: undefined,
            },
          };
          setApartment(transformedApartment);
        } else if (data.source === 'external') {
          const extProperty = data.property;
          setIsRelist(!!extProperty.is_relist);
          setFirstSeenAt(extProperty.created_at ?? null);
          const transformedApartment: Apartment = {
            id: extProperty.id,
            images: extProperty.images || [],
            title: extProperty.title,
            location: extProperty.location,
            price: Number(extProperty.price || 0),
            size: extProperty.size || '',
            vibe: extProperty.vibe || '',
            description: extProperty.description || '',
            highlights: extProperty.highlights || [],
            amenities: extProperty.amenities || [],
            vibe_analysis: extProperty.vibe_analysis,
            property_source_link: extProperty.source_url,
            property_source_provider_name: extProperty.contact_name || extProperty.source,
            property_source_provider_phone: extProperty.contact_phone || undefined,
            rooms: extProperty.rooms || null,
            last_verified_at: extProperty.last_verified_at || null,
            latitude: extProperty.latitude,
            longitude: extProperty.longitude,
            realtor: {
              id: 'external',
              name: extProperty.contact_name || extProperty.source || 'External Listing',
              phone: extProperty.contact_phone || '',
              email: '',
              avatar: undefined,
            },
          };
          setApartment(transformedApartment);
        }
      } catch (error) {
        console.error('Error fetching property:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchProperty();
  }, [id]);


  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-red-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!apartment) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-red-50 flex flex-col items-center justify-center p-4">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold text-gray-900">Property Not Found</h1>
          <p className="text-gray-600">This property may have been removed or is no longer available.</p>
          <Button onClick={() => navigate('/')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Button>
        </div>
      </div>
    );
  }

  const vibeScore = preferences ? calculateVibeScore(apartment, preferences) : null;
  const vibeMatch = preferences ? getVibeAttributeMatch(apartment, preferences) : undefined;

  // Booking saves the listing to Matches and opens Fast-Track coordination -
  // the renter picks times and Hausto handles the owner. External listings have
  // no realtor account, so the Hausto agent is the counterpart.
  const handleBookViewing = async () => {
    if (!user || !apartment) return;
    if (!quota) {
      toast({ title: 'Checking your viewing allowance', description: 'One moment.' });
      return;
    }
    // Free tier gets one coordination on the house; past that the upgrade path
    // takes over rather than a dead button.
    if (!quota.canBook) {
      setIsSubscriptionOpen(true);
      return;
    }
    setIsBooking(true);
    try {
      const isExternal = source === 'external';
      const realtorId = isExternal ? HAUSTO_AGENT_ID : apartment.realtor.id;
      try {
        await createMatch(apartment.id, realtorId, isExternal ? 'external' : 'internal');
      } catch (err) {
        // useMatches already toasts each case. Only an existing match should
        // still proceed; limits and real failures stop here.
        if ((err as Error)?.message !== 'ALREADY_MATCHED') return;
      }

      // Conversations are keyed by renter/realtor pair in match_conversations -
      // the request hangs off that thread so the coordination has somewhere to
      // land and be followed up.
      const conversationId = await getOrCreateConversation(user.id, realtorId);
      if (!conversationId) {
        toast({
          title: 'Could not start the request',
          description: 'The listing was saved to Matches but the conversation could not be opened. Try again from Matches.',
          variant: 'destructive',
        });
        return;
      }
      setScheduleContext({ conversationId, realtorId });
    } finally {
      setIsBooking(false);
    }
  };

  const handleScheduleSubmit = async (scheduleData: ViewingScheduleData) => {
    if (!scheduleContext || !apartment) return;
    try {
      await submitFastTrack({
        conversationId: scheduleContext.conversationId,
        realtorId: scheduleContext.realtorId,
        scheduleData,
        properties: [{
          id: apartment.id,
          title: apartment.title,
          location: apartment.location,
          price: apartment.price,
          imageUrl: apartment.images?.[0] || '',
        }],
      });
      toast({
        title: 'Viewing request sent',
        description: 'Hausto will coordinate the viewing and get back to you soon.',
      });
      setScheduleContext(null);
    } catch (error) {
      console.error('Error submitting viewing schedule:', error);
      toast({
        title: 'Could not send the request',
        description: 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  const jsonLd = apartment ? {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    "name": apartment.title,
    "description": apartment.description,
    "url": `https://hausto.lovable.app/property/${apartment.id}`,
    "image": apartment.images?.slice(0, 5),
    "address": {
      "@type": "PostalAddress",
      "addressLocality": apartment.location,
      "addressCountry": "VN"
    },
    ...(apartment.price && {
      "offers": {
        "@type": "Offer",
        "price": apartment.price,
        "priceCurrency": "VND",
        "availability": "https://schema.org/InStock"
      }
    }),
    ...(apartment.size && { "floorSize": { "@type": "QuantitativeValue", "value": apartment.size } }),
  } : null;

  return (
    <CurrencyProvider>
      {jsonLd && (
        <Helmet>
          <title>{`${apartment!.title} — Hausto`}</title>
          <meta name="description" content={apartment!.description?.substring(0, 160) || `${apartment!.title} in ${apartment!.location}`} />
          <link rel="canonical" href={`https://hausto.lovable.app/property/${apartment!.id}`} />
          <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
        </Helmet>
      )}
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-red-50">
        <main className="container mx-auto px-4 py-5 sm:py-8 max-w-4xl">
          <div className="flex items-center justify-between gap-3 mb-4 sm:mb-6">
            <Button
              variant="ghost"
              onClick={() => navigate('/')}
              aria-label="Go back to home"
            >
              <ArrowLeft className="w-4 h-4 mr-2" aria-hidden="true" />
              Back
            </Button>

            <div className="flex items-center gap-2">
              <CurrencyDropdown />
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                aria-label="Share property"
                onClick={() => shareProperty(apartment.id, apartment.title)}
              >
                <Share2 className="w-4 h-4" aria-hidden="true" />
              </Button>
            </div>
          </div>

          <h1 className="sr-only">{apartment.title} — {apartment.location}</h1>

          <div className="max-w-[760px] mx-auto">
            <PropertyListingCard
              apartment={apartment}
              vibeScore={vibeScore ? { overall: Number(vibeScore.overall), breakdown: vibeScore.breakdown } : undefined}
              preferences={preferences}
              vibeMatch={vibeMatch}
              onBookViewing={user ? handleBookViewing : undefined}
              isBooking={isBooking}
            />
          </div>

          <ViewingScheduleModal
            isOpen={!!scheduleContext}
            onClose={() => setScheduleContext(null)}
            onSubmit={handleScheduleSubmit}
            matchedProperties={[{
              id: apartment.id,
              title: apartment.title,
              images: apartment.images,
              location: apartment.location,
              price: apartment.price,
            }]}
            initialSelectedIds={[apartment.id]}
          />

          <SubscriptionModal
            isOpen={isSubscriptionOpen}
            onClose={() => setIsSubscriptionOpen(false)}
            reason={quota?.trialUsed ? 'viewings' : undefined}
          />

          <ListingHistoryNote
            listingId={apartment.id}
            enabled={source === 'external'}
            firstSeenAt={firstSeenAt}
            isRelist={isRelist}
          />

          {!user && (
            <Card className="mt-4 max-w-[760px] mx-auto">
              <CardContent className="pt-6">
                <div className="text-center space-y-4">
                  <p className="text-muted-foreground">
                    Sign in to connect with the property owner and schedule a viewing.
                  </p>
                  <Button 
                    onClick={() => navigate('/auth')}
                    className="w-full"
                  >
                    <LogIn className="w-4 h-4 mr-2" />
                    Sign In to Contact
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </main>

        {user && (
          <HaustoChat
            isOpen={isChatOpen}
            onClose={() => setIsChatOpen(false)}
            userType="renter"
            userPreferences={preferences}
            initialMatchId={chatConversationId}
            initialPropertyId={apartment.id}
          />
        )}

        {showRealtorProfile && apartment.realtor && (
          <RealtorProfileModal
            realtorId={apartment.realtor.id}
            isOpen={showRealtorProfile}
            onClose={() => setShowRealtorProfile(false)}
          />
        )}
      </div>
    </CurrencyProvider>
  );
};

export default PropertyDetail;
