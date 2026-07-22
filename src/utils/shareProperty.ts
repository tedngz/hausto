import { toast } from '@/hooks/use-toast';

/**
 * Share a listing via the native share sheet, falling back to copying the link.
 * External swipe cards carry an "ext-" prefix; the public detail route resolves
 * listings by their raw id.
 */
export const shareProperty = async (
  id: string,
  title: string,
  options?: {
    /** Also open the listing page in a new tab (used by the property card) */
    openPage?: boolean;
  },
) => {
  const shareUrl = `${window.location.origin}/property/${String(id).replace(/^ext-/, '')}`;
  const shareData = { title, text: `Check out this rental on Hausto: ${title}`, url: shareUrl };

  const copyLink = async () => {
    await navigator.clipboard.writeText(shareUrl);
    toast({ title: 'Link copied', description: 'Property link copied to your clipboard.' });
  };

  if (options?.openPage) {
    // Open before awaiting the clipboard write, otherwise the click gesture is
    // spent and the popup blocker rejects the tab.
    window.open(shareUrl, '_blank', 'noopener,noreferrer');
    try {
      await copyLink();
    } catch {
      toast({ title: 'Could not copy link', description: 'The listing opened in a new tab.', variant: 'destructive' });
    }
    return;
  }

  try {
    if (typeof navigator.share === 'function' && navigator.canShare?.(shareData)) {
      await navigator.share(shareData);
      return;
    }
    await copyLink();
  } catch (err) {
    // Swallow user-cancelled share (AbortError); surface only real failures.
    if ((err as Error)?.name === 'AbortError') return;
    try {
      await copyLink();
    } catch {
      toast({ title: 'Could not share', description: 'Please try again.', variant: 'destructive' });
    }
  }
};
