import { useQuery } from '@tanstack/react-query';
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
  property_source_link: external ? p.source_url : p.property_source_link,
  last_verified_at: external ? p.last_verified_at ?? null : null,
  realtor: { id: external ? 'external' : p.realtor_id, name: 'Property Owner', phone: '', email: '' },
});

export const ListingCardDialog = ({ propertyId, open, onOpenChange }: ListingCardDialogProps) => {
  const { data: apartment, isLoading } = useQuery({
    queryKey: ['listing-card', propertyId],
    enabled: open && !!propertyId,
    queryFn: async (): Promise<Apartment | null> => {
      const { data: internal } = await supabase
        .from('properties')
        .select('*')
        .eq('id', propertyId!)
        .maybeSingle();
      if (internal) return toApartment(internal, false);

      const { data: external } = await supabase
        .from('external_properties')
        .select('*')
        .eq('id', propertyId!)
        .maybeSingle();
      return external ? toApartment(external, true) : null;
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Close lives inline with share/like via the card's onClose - hide the default dialog X */}
      <DialogContent className="max-w-md p-0 gap-0 bg-transparent border-0 shadow-none [&>button]:hidden">
        <DialogTitle className="sr-only">{apartment?.title || 'Listing'}</DialogTitle>
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-white" />
          </div>
        ) : apartment ? (
          <EditorialPropertyCard apartment={apartment} onClose={() => onOpenChange(false)} />
        ) : (
          <div className="rounded-xl bg-card p-6 text-center text-sm text-muted-foreground">
            This listing is no longer available.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
