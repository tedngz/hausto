import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { Property } from '@/hooks/useProperties';
import { PropertyCard } from '@/components/PropertyCard';
import { Apartment } from '@/pages/Index';

interface PropertyPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  property: Property | null;
}

export const PropertyPreviewModal = ({ isOpen, onClose, property }: PropertyPreviewModalProps) => {
  if (!isOpen || !property) return null;

  // Transform Property to Apartment for preview to ensure identical card design
  const previewApartment: Apartment = {
    id: property.id,
    images: property.images || [],
    title: property.title,
    location: property.location,
    price: Number(property.price),
    size: property.size || '',
    vibe: property.vibe || '',
    description: property.description || '',
    highlights: property.highlights || [],
    realtor: {
      id: property.realtor_id,
      name: 'Licensed Realtor',
      phone: '+1-234-567-8900',
      email: 'contact@realtor.com'
    },
    vibe_analysis: property.vibe_analysis
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-5xl max-h-[90vh] overflow-y-auto bg-white/90">
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Property Preview</h2>
            <p className="text-gray-600">How your listing appears to renters</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close preview">
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="p-6">
          <PropertyCard
            apartment={previewApartment}
            showFullTitle
            showFullDescription
            showAllHighlights
            showContactButton={false}
            showViewProfileButton={false}
          />
        </div>
      </Card>
    </div>
  );
};
