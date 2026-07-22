import { toast } from '@/hooks/use-toast';

/**
 * Share a listing via the native share sheet, falling back to copying the link.
 * External swipe cards carry an "ext-" prefix; the public detail route resolves
 * listings by their raw id.
 */
export const shareProperty = async (id: string, title: string) => {
  const shareUrl = `${window.location.origin}/property/${String(id).replace(/^ext-/, '')}`;
  const shareData = { title, text: `Check out this rental on Hausto: ${title}`, url: shareUrl };

  const copyLink = async () => {
    await navigator.clipboard.writeText(shareUrl);
    toast({ title: 'Link copied', description: 'Property link copied to your clipboard.' });
  };

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
