import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  EditorialPropertyCard,
  type EditorialApartment,
  type VibeScoreDetails,
  type VibeMatchAttributes,
} from '@/components/EditorialPropertyCard';
import type { PropertyType } from '@/hooks/useDeepAnalysis';
import { RequestViewingOffer } from '@/components/RequestViewingOffer';
import { HubPanelScrim } from '@/components/hub/HubPanelScrim';
import { HUB_PANEL_POSITION } from '@/lib/hubLayout';
import { useHasAgentNumber } from '@/hooks/useHasAgentNumber';

// The one way a listing opens over the page it was found on - browse, the AI's
// results, anywhere a card is clicked. There used to be a second, older modal
// wrapping PropertyCard; it showed a different listing to the same renter
// depending on which surface they came from, which is why it is gone.
//
// Everything a renter can do from here is inside the card itself: the booking
// offer rides in the card's footer slot rather than as a panel stacked under
// it, because the offer is the modal's whole forward path and a floating note
// under a card reads as something else's.

interface ListingPreviewDialogProps {
  apartment: EditorialApartment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Inside the hub: not modal, and positioned clear of the chat rail and dock,
   *  so the renter can ask about the listing they are looking at. */
  embedded?: boolean;
  vibeScore?: VibeScoreDetails;
  vibeMatch?: VibeMatchAttributes;
  vibeDetailsText?: string;
  scoreContext?: 'search' | 'preferences';
  quoteFallback?: string;
  liked?: boolean;
  onLike?: () => void;
  /** Opens the viewing request flow. Without it the card shows no CTA and the
   *  offer below it would be promising something this surface cannot do. */
  onSchedule?: () => void;
  /** Where the listing came from, as the way out to the original posting. */
  source?: { name: string; href?: string | null };
  /** Which ledger the listing lives in, forwarded to the card so its Deep Scan
   *  chip reads the right one. */
  propertyType?: PropertyType;
}


export const ListingPreviewDialog = ({
  apartment,
  open,
  onOpenChange,
  embedded = false,
  vibeScore,
  vibeMatch,
  vibeDetailsText,
  scoreContext = 'preferences',
  quoteFallback,
  liked,
  onLike,
  onSchedule,
  source,
  propertyType = 'internal',
}: ListingPreviewDialogProps) => {

  // Search truncates descriptions to 300 characters to keep the results
  // payload small, and both surfaces that open this preview - browse and the
  // AI's results - are fed by it. So the prose arrived cut mid-sentence with
  // nothing behind the card's "more" toggle. The full text only exists on the
  // row, and this is the one preview both surfaces share, so it is topped up
  // here rather than in each caller.
  //
  const isExternal = propertyType === 'external';
  const { data: listingFacts } = useQuery({
    queryKey: ['listing-preview-facts', propertyType, apartment?.id],
    enabled: open && !!apartment?.id,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<{ description: string | null }> => {
      const { data } = isExternal
        ? await supabase.from('external_properties').select('description').eq('id', apartment!.id).maybeSingle()
        : await supabase.from('properties').select('description').eq('id', apartment!.id).maybeSingle();
      const row = data as { description?: string | null } | null;
      return { description: row?.description ?? null };
    },
  });
  const fullDescription = listingFacts?.description ?? null;

  // Asked as the preview opens, so "Request viewing" opens straight on its
  // choice - we arrange it, or call the agent - where the ad lists a number.
  useHasAgentNumber(apartment?.id, open && isExternal && !!onSchedule);

  // Only ever lengthens it: a row that is genuinely short must not be replaced
  // by a stale or empty read.
  const previewApartment =
    apartment && fullDescription && fullDescription.length > (apartment.description?.length ?? 0)
      ? { ...apartment, description: fullDescription }
      : apartment;

  // The request's small print, as the listing page shows it.
  const bookingOffer = onSchedule ? <RequestViewingOffer source={source} /> : null;

  return (
    <>
      {/* Only the embedded copy needs one: off the hub the dialog is modal and
          brings its own overlay. */}
      <HubPanelScrim open={embedded && open} onDismiss={() => onOpenChange(false)} />

      <Dialog open={open} modal={!embedded} onOpenChange={onOpenChange}>
        {/* Close lives inline with share/like via the card's onClose - hide the
            default dialog X. Phones match the swipe/matches width so a listing
            looks the same wherever it opens; desktop keeps the roomier modal.
            Bound to the viewport and scrolling, in dvh rather than vh, so a
            collapsing address bar cannot hide the bottom of it. */}
        <DialogContent
          overlayClassName={embedded ? 'hidden' : undefined}
          // A tap on the chat is not a tap to dismiss. Radix dismisses a
          // non-modal panel on any interaction outside it, so reaching for the
          // rail - or the dock, on a phone - closed the listing the renter was
          // about to ask about. The card carries its own close button, and
          // Escape still works.
          onInteractOutside={embedded ? (e) => e.preventDefault() : undefined}
          className={`max-w-md sm:max-w-[760px] max-h-[92dvh] overflow-y-auto overscroll-contain p-0 gap-0 bg-transparent border-0 shadow-none [&>button]:hidden ${
            embedded ? HUB_PANEL_POSITION : ''
          }`}
        >
          <DialogTitle className="sr-only">{apartment?.title || 'Listing'}</DialogTitle>
          {apartment && (
            <EditorialPropertyCard
              apartment={previewApartment!}
              propertyType={propertyType}
              vibeScore={vibeScore}
              vibeMatch={vibeMatch}
              vibeDetailsText={vibeDetailsText}
              scoreContext={scoreContext}
              quoteFallback={quoteFallback}
              defaultExpanded
              liked={liked}
              onLike={onLike}
              onClose={() => onOpenChange(false)}
              onSchedule={onSchedule}
              scheduleLabel="Request viewing"
              footer={bookingOffer}
            />
          )}
          {/* What we have seen of the listing over time - price moves, days on
              the market - is in its Deep Scan now (ListingHistoryNote). */}
        </DialogContent>
      </Dialog>
    </>
  );
};
