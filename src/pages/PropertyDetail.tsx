import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
        // Fetch property
        const { data: property, error: propertyError } = await supabase
          .from('properties')
          .select('*')
          .eq('id', id)
          .eq('is_active', true)
          .maybeSingle();

        if (propertyError) throw propertyError;

        if (!property) {
          setLoading(false);
          return;
        }

        // Fetch realtor profile (may not be available for non-authenticated users)
        const { data: realtor } = await supabase
          .from('profiles')
          .select('id, name, phone, email, avatar_url, bio')
          .eq('id', property.realtor_id)
          .maybeSingle();

        // Transform to Apartment type
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
          vibe_analysis: property.vibe_analysis,
          property_source_link: property.property_source_link,
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

  return (
    <CurrencyProvider>
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-red-50">
        <div className="container mx-auto px-4 py-8 max-w-3xl">
          <Button
            variant="ghost"
            onClick={() => navigate('/')}
            className="mb-6"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>

          <PropertyCard
            apartment={apartment}
            onContact={() => setShowContactModal(true)}
            onViewProfile={() => setShowRealtorProfile(true)}
            showContactButton={!!user}
            showViewProfileButton={!!user}
            showFullTitle={true}
            showFullDescription={true}
            showAllHighlights={true}
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
        </div>

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
