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
      className={`w-[min(100vw-2rem,56rem)] max-w-none overflow-y-auto p-0 [&>button]:hidden ${HUB_PANEL_POSITION}`}
    >
      {complex && (
        <>
          {/* The profile carries its own heading; this one names the dialog
              for screen readers. */}
          <DialogHeader className="sr-only">
            <DialogTitle>{complex.name}</DialogTitle>
          </DialogHeader>

          {/* Floats over the profile's hero, which scrolls under it */}
          <div className="sticky top-0 z-20 flex justify-end gap-2 p-3">
            <button
              aria-label={`Ask the AI about ${complex.name}`}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/90 text-primary-foreground shadow-lg backdrop-blur-md hover:bg-primary"
              onClick={() => onAskAI(complex)}
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              aria-label="Close"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground/70 text-background shadow-lg backdrop-blur-md hover:bg-foreground"
              onClick={onClose}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {/* Pulls the profile back up under the floating actions */}
          <div className="-mt-14">
            <ComplexProfile complex={complex} variant="panel" />
          </div>
        </>
      )}
    </DialogContent>
  </Dialog>
);
