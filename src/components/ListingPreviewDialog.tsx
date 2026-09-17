import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  EditorialPropertyCard,
  type EditorialApartment,
  type VibeScoreDetails,
  type VibeMatchAttributes,
} from '@/components/EditorialPropertyCard';
import type { PropertyType } from '@/hooks/useDeepAnalysis';
import { useViewingQuota, INCLUDED_VIEWINGS_PER_CYCLE } from '@/hooks/useViewingQuota';
import { usePass } from '@/hooks/usePass';
import { HubPanelScrim } from '@/components/hub/HubPanelScrim';
import { HUB_PANEL_POSITION } from '@/lib/hubLayout';

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

const OFFER_POINTS = [
  'English-speaking coordination',
  'Complete privacy - no spam or shared contact info',
  'Zero back-and-forth messaging',
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
  const { quota } = useViewingQuota();

  // Search truncates descriptions to 300 characters to keep the results
  // payload small, and both surfaces that open this preview - browse and the
  // AI's results - are fed by it. So the prose arrived cut mid-sentence with
  // nothing behind the card's "more" toggle. The full text only exists on the
  // row, and this is the one preview both surfaces share, so it is topped up
  // here rather than in each caller.
  const { data: fullDescription } = useQuery({
    queryKey: ['listing-description', propertyType, apartment?.id],
    enabled: open && !!apartment?.id,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<string | null> => {
      const table = propertyType === 'external' ? 'external_properties' : 'properties';
      const { data } = await supabase
        .from(table)
        .select('description')
        .eq('id', apartment!.id)
        .maybeSingle();
      return (data as { description?: string | null } | null)?.description ?? null;
    },
  });

  // Only ever lengthens it: a row that is genuinely short must not be replaced
  // by a stale or empty read.
  const previewApartment =
    apartment && fullDescription && fullDescription.length > (apartment.description?.length ?? 0)
      ? { ...apartment, description: fullDescription }
      : apartment;

  // Why book through Hausto rather than calling the number on the original
  // posting. Sits above the way out to that posting, deliberately: the offer
  // has to be legible before the exit is.
  const bookingOffer = onSchedule ? (
    <>
      <p className="text-sm font-medium">
        Just pick a time, we&rsquo;ll arrange with the agent/owner.
      </p>
      <ul className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-3">
        {OFFER_POINTS.map((point) => (
          <li key={point} className="flex items-start gap-1.5">
            <Check className="w-3.5 h-3.5 mt-px flex-shrink-0 text-emerald-600" />
            <span>{point}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-border/60 pt-2.5">
        <span className="text-xs text-muted-foreground">
          {quota?.hasPack
            ? `${quota.remaining} viewing request${quota.remaining === 1 ? '' : 's'} left`
            : quota?.trialAvailable
              ? 'Your first viewing is on us'
              : quota?.trialLocked
                ? 'Match 3 listings to unlock your free viewing'
                : quota?.trialUsed
                ? `Free trial used - the Pass includes ${INCLUDED_VIEWINGS_PER_CYCLE}`
                : pass?.active
                  ? `${quota?.remaining ?? INCLUDED_VIEWINGS_PER_CYCLE} viewing requests left this cycle`
                  : 'Your first viewing is on us'}
        </span>
        {source?.href && (
          <a
            href={source.href}
            target={source.href.startsWith('/') ? undefined : '_blank'}
            rel={source.href.startsWith('/') ? undefined : 'noopener noreferrer'}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground whitespace-nowrap"
          >
            View original on {source.name}
          </a>
        )}
      </div>
    </>
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
        </DialogContent>
      </Dialog>
    </>
  );
};
