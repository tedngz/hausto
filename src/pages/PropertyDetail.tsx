import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { PropertyCard } from '@/components/PropertyCard';
import { ContactModal } from '@/components/ContactModal';
import { RealtorProfileModal } from '@/components/RealtorProfileModal';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2, LogIn } from 'lucide-react';
import { Apartment } from '@/types';
import { CurrencyProvider } from '@/contexts/CurrencyContext';
import { Card, CardContent } from '@/components/ui/card';

const PropertyDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [apartment, setApartment] = useState<Apartment | null>(null);
  const [loading, setLoading] = useState(true);
  const [showContactModal, setShowContactModal] = useState(false);
  const [showRealtorProfile, setShowRealtorProfile] = useState(false);

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
        <main className="container mx-auto px-4 py-8 max-w-3xl">
          <Button
            variant="ghost"
            onClick={() => navigate('/')}
            className="mb-6"
            aria-label="Go back to home"
          >
            <ArrowLeft className="w-4 h-4 mr-2" aria-hidden="true" />
            Back
          </Button>

          <h1 className="sr-only">{apartment.title} — {apartment.location}</h1>

          <PropertyCard
            apartment={apartment}
            onContact={() => setShowContactModal(true)}
            showContactButton={!!user}
            showFullTitle={true}
            showFullDescription={true}
            showAllHighlights={true}
            showRealtorInfo={!!user}
            className="max-w-md mx-auto"
          />

          {!user && (
            <Card className="mt-4">
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

        {showContactModal && (
          <ContactModal
            apartment={apartment}
            onClose={() => setShowContactModal(false)}
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
