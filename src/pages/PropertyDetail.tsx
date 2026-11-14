import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { PropertyListingCard } from '@/components/PropertyListingCard';
import { HomeAI } from '@/components/HomeAI';
import { ChatDock, RAIL_MIN_VIEWPORT } from '@/components/chat/ChatDock';
import { RealtorProfileModal } from '@/components/RealtorProfileModal';
import { useQueryClient } from '@tanstack/react-query';
import { agentNumberKey, marketplaceName, type AgentNumberInfo } from '@/hooks/useHasAgentNumber';
import { Button } from '@/components/ui/button';
import { CurrencyDropdown } from '@/components/CurrencyDropdown';
import { shareProperty } from '@/utils/shareProperty';
import { ArrowLeft, Loader2, Share2 } from 'lucide-react';
import { Apartment, UserPreferences } from '@/types';
import { CurrencyProvider } from '@/contexts/CurrencyContext';
import { dbToPreferences, hasMeaningfulPreferences } from '@/lib/preferences';
import { calculateVibeScore, getVibeAttributeMatch } from '@/utils/vibeScoring';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { ASSISTANT_OPEN_EVENT } from '@/lib/assistantEvents';
import { DEEP_SCAN_EVENT } from '@/lib/deepScanEvents';
import { rememberOfferInquiry } from '@/lib/offerInquiry';

const PropertyDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [apartment, setApartment] = useState<Apartment | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRealtorProfile, setShowRealtorProfile] = useState(false);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [source, setSource] = useState<'internal' | 'external'>('internal');
  const queryClient = useQueryClient();

  // Opened from an availability request's offer (`?inq=`): remembered so the
  // viewing request made from here links back to it.
  useEffect(() => {
    if (id) rememberOfferInquiry(id, new URLSearchParams(window.location.search).get('inq'));
  }, [id]);

  // The chat docks the same way it does on the hub: a rail beside the listing
  // at desktop widths, a draggable sheet along the bottom below them.
  const hasRail = useMediaQuery(`(min-width: ${RAIL_MIN_VIEWPORT}px)`);
  // On narrow viewports the sheet starts collapsed - the listing is what the
  // renter came for - and the card's own gestures open it (below).
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatHeaderPortal, setChatHeaderPortal] = useState<HTMLDivElement | null>(null);

  // A Deep scan or a sparkle fired from the card is answered in the chat, which
  // on a phone is a collapsed bar: without this the press looks like it did
  // nothing and the reply arrives out of sight. Same reasoning as the hub's.
  // The sparkle is not a signed-in feature here. The chat already knows the
  // listing this page is about and a signed-out visitor's message carries the
  // pinned id like anyone else's, so asking about it just works - the free
  // search allowance is what eventually asks them to sign in, not the gesture.
  useEffect(() => {
    const open = () => {
      if (!hasRail) setIsChatOpen(true);
    };
    // The scan is the exception: it is written against saved preferences and
    // only rendered for an account, so a press with no way to answer it should
    // say so rather than open an empty sheet.
    const scan = () => {
      if (!user) {
        navigate('/auth', { state: { returnTo: `/property/${id}` } });
        return;
      }
      open();
    };
    window.addEventListener(ASSISTANT_OPEN_EVENT, open);
    window.addEventListener(DEEP_SCAN_EVENT, scan);
    return () => {
      window.removeEventListener(ASSISTANT_OPEN_EVENT, open);
      window.removeEventListener(DEEP_SCAN_EVENT, scan);
    };
  }, [hasRail, user, navigate, id]);

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
          // Whether the ad carries a number - never the number. Seeded so
          // "Request viewing" opens straight on its choice (ViewingChoice).
          queryClient.setQueryData<AgentNumberInfo>(agentNumberKey(extProperty.id), {
            hasNumber: extProperty.has_agent_number === true,
            sourceName: marketplaceName(extProperty.source),
          });
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
  }, [id, queryClient]);


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


  const jsonLd = apartment ? {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    "name": apartment.title,
    "description": apartment.description,
    "url": `https://www.hausto.com/property/${apartment.id}`,
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

  // One chat instance, moved between the rail and the sheet by which of the
  // two ChatDock renders - never both, so the conversation is never doubled.
  // It opens pinned to the listing on the page: that is what a renter reading
  // this page is going to ask about, and a Deep scan asked for from the card
  // lands in the same thread.
  const chat = (
    <HomeAI
      variant="rail"
      userPreferences={preferences ?? undefined}
      initialSubjects={[{ propertyId: apartment.id, title: apartment.title }]}
      headerPortal={chatHeaderPortal}
    />
  );

  return (
    <CurrencyProvider>
      {jsonLd && (
        <Helmet>
          <title>{`${apartment!.title} — Hausto`}</title>
          <meta name="description" content={apartment!.description?.substring(0, 160) || `${apartment!.title} in ${apartment!.location}`} />
          <link rel="canonical" href={`https://www.hausto.com/property/${apartment!.id}`} />
          <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
        </Helmet>
      )}
      {/* The hub's two-pane shape: the listing scrolls in its own pane so the
          chat beside it keeps its own scroll and its composer stays put. */}
      <div className="flex h-[var(--app-h)] flex-col overflow-hidden bg-gradient-to-br from-orange-50 via-white to-red-50">
        <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto">
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
              // Crawled listings only: the viewing flow requests against
              // `external_properties`. A realtor's own listing has no request
              // path since Fast-Track retired (invariant 8) - none is live.
              shortlistable={source === 'external'}
              propertyType={source}
            />
          </div>


          {/* No second CTA here. The card's "Request viewing" is the only one,
              and the modal it opens asks a signed-out visitor to sign in - so a
              separate "Sign in to book viewing" button was a second button for
              the same job, one step earlier, in vocabulary invariant 6 forbids
              before a request is CONFIRMED. */}
        </main>
        </div>

          {hasRail && (
            <ChatDock
              hasRail
              isOpen={isChatOpen}
              onOpenChange={setIsChatOpen}
              onHeaderPortalChange={setChatHeaderPortal}
            >
              {chat}
            </ChatDock>
          )}
        </div>

        {!hasRail && (
          <ChatDock
            hasRail={false}
            isOpen={isChatOpen}
            onOpenChange={setIsChatOpen}
            collapsedHint="Ask about this listing"
            onHeaderPortalChange={setChatHeaderPortal}
          >
            {chat}
          </ChatDock>
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
