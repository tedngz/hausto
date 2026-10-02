import { Sparkles, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ComplexProfile } from '@/components/ComplexProfile';
import { type Complex } from '@/hooks/useComplexes';
import { HubPanelScrim } from '@/components/hub/HubPanelScrim';
import { HUB_PANEL_POSITION } from '@/lib/hubLayout';

interface HubComplexPanelProps {
  complex: Complex | null;
  onClose: () => void;
  onAskAI: (complex: Complex) => void;
}

/**
 * A building profile read beside the chat rather than instead of it.
 *
 * Shows the FULL profile - the same component /complexes/:slug renders. An
 * abridged version here would have made the hub the worse place to read about a
 * building, which defeats the point of bringing it in.
 *
 * Deliberately not modal: the reason to open a complex here is being able to
 * ask about it while you read.
 */
export const HubComplexPanel = ({ complex, onClose, onAskAI }: HubComplexPanelProps) => (
  <Dialog open={!!complex} modal={false} onOpenChange={(o) => { if (!o) onClose(); }}>
    {/* Blurs the directory behind the profile without touching the chat. */}
    <HubPanelScrim open={!!complex} onDismiss={onClose} />

    <DialogContent
      overlayClassName="hidden"
      // Reaching for the chat is not dismissing the profile - see
      // ListingPreviewDialog.
      onInteractOutside={(e) => e.preventDefault()}
      // gap-0: the base dialog is a gap-4 grid, which opened a strip of
      // background between the floating actions and the hero.
      // On a phone it takes the listing preview's shape - full width up to
      // max-w-md, 22px corners like EditorialPropertyCard - so a building and
      // a listing open as the same kind of sheet. The sm: radius is repeated
      // because the base dialog's sm:rounded-lg would otherwise win from sm up.
      className={`w-full max-w-md sm:w-[min(100vw-2rem,56rem)] sm:max-w-none rounded-[22px] sm:rounded-[22px] gap-0 overflow-y-auto p-0 [&>button]:hidden ${HUB_PANEL_POSITION}`}
    >
      {complex && (
        <>
          {/* The profile carries its own heading; this one names the dialog
              for screen readers. */}
          <DialogHeader className="sr-only">
            <DialogTitle>{complex.name}</DialogTitle>
          </DialogHeader>

          {/* Floats over the profile's hero, which scrolls under it. The row
              is zero-height so the hero starts flush with the top edge rather
              than below a pulled-back margin that has to match its height. */}
          <div className="sticky top-0 z-20 h-0">
            <div className="pointer-events-none flex justify-end gap-2 p-3">
              <button
                aria-label={`Ask the AI about ${complex.name}`}
                className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full bg-primary/90 text-primary-foreground shadow-lg backdrop-blur-md hover:bg-primary"
                onClick={() => onAskAI(complex)}
              >
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                aria-label="Close"
                className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full bg-foreground/70 text-background shadow-lg backdrop-blur-md hover:bg-foreground"
                onClick={onClose}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          <ComplexProfile complex={complex} variant="panel" />
        </>
      )}
    </DialogContent>
  </Dialog>
);
