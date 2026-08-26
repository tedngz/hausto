import { createPortal } from 'react-dom';

/**
 * The blur behind a hub panel.
 *
 * The panels on this page (listing preview, compare, complex profile) are
 * deliberately not modal - a scrim across the whole viewport with a focus trap
 * behind it would cover the chat, and asking about the thing you are looking at
 * is the point of the hub. But with no scrim at all the panel floated over a
 * fully legible table, and there was nothing to say which of the two the renter
 * was meant to be reading.
 *
 * So this is a scrim over the MAIN PANE only: it stops at the chat rail at xl,
 * and at the top of the dock below it, using the same two variables every other
 * floating surface here measures against (see lib/hubLayout). The chat stays
 * sharp, reachable and typeable while the browse side goes soft.
 *
 * Portaled to the body rather than rendered in place: `fixed` inside a
 * DialogContent would be trapped by its transform, and inside the main pane it
 * would scroll away with the table.
 *
 * z-40, below the z-50 panel and above the compare bar it shares that number
 * with - the portal is later in the document, so it wins the tie.
 */
interface HubPanelScrimProps {
  open: boolean;
  /** Clicking the scrim closes the panel, the way a backdrop is expected to.
   *  The panels themselves ignore outside interaction, because that is how a
   *  tap on the chat used to dismiss them. */
  onDismiss?: () => void;
}

export const HubPanelScrim = ({ open, onDismiss }: HubPanelScrimProps) => {
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      aria-hidden="true"
      onClick={onDismiss}
      className="fixed inset-x-0 top-[var(--hub-nav)] bottom-[var(--hub-dock)] z-40 bg-white/40 backdrop-blur-sm transition-[bottom] duration-200 animate-in fade-in-0 xl:right-[var(--hub-rail)]"
    />,
    document.body,
  );
};
