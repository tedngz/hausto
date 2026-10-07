import { useQuery } from '@tanstack/react-query';
import { PROPERTY_PUBLIC_COLUMNS } from '@/lib/propertyColumns';
import { EXTERNAL_PROPERTY_PUBLIC_COLUMNS } from '@/lib/externalPropertyColumns';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { EditorialPropertyCard } from '@/components/EditorialPropertyCard';
import { supabase } from '@/integrations/supabase/client';
import { Apartment } from '@/types';

// Pops the listing card for a bare property id — used where the surrounding UI
// only carries an id and a title (e.g. the realtor's escalated-questions list).
// Internal listings first, falling back to the external table, mirroring how the
// chat resolves a property.

interface ListingCardDialogProps {
  propertyId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const toApartment = (p: any, external: boolean): Apartment => ({
  id: p.id,
  images: p.images || [],
  title: p.title,
  location: p.location,
  price: Number(p.price || 0),
  size: p.size || '',
  vibe: p.vibe || '',
  description: p.description || '',
  highlights: p.highlights || [],
  amenities: p.amenities || [],
  vibe_analysis: p.vibe_analysis,
  rooms: p.rooms ?? null,
  // Never the original listing: it carries the agent's number, which only
  // ViewingChoice gives out, to a signed-in renter.
  property_source_link: external ? undefined : p.property_source_link,
  last_verified_at: external ? p.last_verified_at ?? null : null,
  realtor: { id: external ? 'external' : p.realtor_id, name: 'Property Owner', phone: '', email: '' },
});

export const ListingCardDialog = ({ propertyId, open, onOpenChange }: ListingCardDialogProps) => {
  const { data: found, isLoading } = useQuery({
    queryKey: ['listing-card', propertyId],
    enabled: open && !!propertyId,
    queryFn: async (): Promise<{ apartment: Apartment; external: boolean } | null> => {
      const { data: internal } = await supabase
        .from('properties')
        .select(PROPERTY_PUBLIC_COLUMNS)
        .eq('id', propertyId!)
        .maybeSingle();
      if (internal) return { apartment: toApartment(internal, false), external: false };

      const { data: external } = await supabase
        .from('external_properties')
        .select(EXTERNAL_PROPERTY_PUBLIC_COLUMNS)
        .eq('id', propertyId!)
        .maybeSingle();
      return external ? { apartment: toApartment(external, true), external: true } : null;
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Close lives inline with share/like via the card's onClose - hide the default dialog X */}
      <DialogContent className="max-w-md p-0 gap-0 bg-transparent border-0 shadow-none [&>button]:hidden">
        <DialogTitle className="sr-only">{found?.apartment.title || 'Listing'}</DialogTitle>
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-white" />
          </div>
        ) : found ? (
          <EditorialPropertyCard
            apartment={found.apartment}
            propertyType={found.external ? 'external' : 'internal'}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <div className="rounded-xl bg-card p-6 text-center text-sm text-muted-foreground">
            This listing is no longer available.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
