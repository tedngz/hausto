import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, Languages, ShieldCheck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  EditorialPropertyCard,
  type EditorialApartment,
  type VibeScoreDetails,
  type VibeMatchAttributes,
} from '@/components/EditorialPropertyCard';
import type { PropertyType } from '@/hooks/useDeepAnalysis';
import { PASS_DAYS, PASS_PRICE_USD, usePass } from '@/hooks/usePass';
import { HubPanelScrim } from '@/components/hub/HubPanelScrim';
import { HUB_PANEL_POSITION } from '@/lib/hubLayout';
import { ListingHistoryNote } from '@/components/ListingHistoryNote';
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

// Icons in the card's own accent, as its amenities are - a green tick here
// read as a second design system bolted under the button.
const OFFER_POINTS = [
  { icon: CalendarCheck, text: 'We arrange it with the agent' },
  { icon: Languages, text: 'English-speaking coordination' },
  { icon: ShieldCheck, text: 'Your contact details stay private' },
];

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
  const { pass } = usePass();

  // Search truncates descriptions to 300 characters to keep the results
  // payload small, and both surfaces that open this preview - browse and the
  // AI's results - are fed by it. So the prose arrived cut mid-sentence with
  // nothing behind the card's "more" toggle. The full text only exists on the
  // row, and this is the one preview both surfaces share, so it is topped up
  // here rather than in each caller.
  //
  // A crawled listing's history note needs when we first saw it and whether
  // it is a relist, which no caller passes, so they come with the same read.
  const isExternal = propertyType === 'external';
  const { data: listingFacts } = useQuery({
    queryKey: ['listing-preview-facts', propertyType, apartment?.id],
    enabled: open && !!apartment?.id,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<{ description: string | null; createdAt: string | null; isRelist: boolean }> => {
      const { data } = isExternal
        ? await supabase.from('external_properties').select('description, created_at, is_relist').eq('id', apartment!.id).maybeSingle()
        : await supabase.from('properties').select('description').eq('id', apartment!.id).maybeSingle();
      const row = data as { description?: string | null; created_at?: string | null; is_relist?: boolean | null } | null;
      return {
        description: row?.description ?? null,
        createdAt: row?.created_at ?? null,
        isRelist: !!row?.is_relist,
      };
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

  // Why book through Hausto rather than calling the number on the original
  // posting. It is the button's small print, so it hangs off the button with
  // no rules of its own: what it costs first, then what we do, then the way
  // out to that posting - the offer has to be legible before the exit is.
  const bookingOffer = onSchedule ? (
    <div className="flex flex-col items-center gap-2.5 text-center">
      <p className="text-[12.5px] text-muted-foreground [text-wrap:balance]">
        {/* Arranging viewings is the Pass's, with one free place per
            WhatsApp number (requestGate, SPEC §9). */}
        {pass?.active ? (
          <>
            <span className="font-medium text-foreground">Covered by your Pass</span>
            {' - every viewing we arrange'}
          </>
        ) : (
          <>
            <span className="font-medium text-foreground">Your first viewing is on us</span>
            {` - then the Pass ($${PASS_PRICE_USD} for ${PASS_DAYS} days)`}
          </>
        )}
      </p>
      <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-[12px] text-muted-foreground">
        {OFFER_POINTS.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-1.5">
            <Icon className="w-3.5 h-3.5 flex-shrink-0 text-primary" aria-hidden="true" />
            <span>{text}</span>
          </li>
        ))}
      </ul>
      {/* Our own page only. A crawled listing's original ad carries the
          agent's number, which reaches a renter only through the request
          modal's choice, signed in and logged (CLAUDE.md invariant 4) - so an
          outside link is dropped here even if a caller passes one. */}
      {source?.href?.startsWith('/') && (
        <a
          href={source.href}
          className="text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          View on {source.name}
        </a>
      )}
    </div>
  ) : null;

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
          className={`max-w-md sm:max-w-2xl max-h-[92dvh] overflow-y-auto overscroll-contain p-0 gap-0 bg-transparent border-0 shadow-none [&>button]:hidden ${
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
          {/* What we have seen of it over time, as the listing page shows it
              under its card. Facts about the place, not an action, so it sits
              outside the card rather than in its footer. */}
          {/* Wrapped: in the dialog's grid the note's own mx-auto would
              shrink it to its text instead of the card's width. */}
          {apartment && isExternal && (
            <div>
              <ListingHistoryNote
                listingId={apartment.id}
                enabled
                firstSeenAt={listingFacts?.createdAt ?? null}
                isRelist={listingFacts?.isRelist ?? false}
                className="mt-3 max-w-none rounded-2xl border-border bg-card"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
