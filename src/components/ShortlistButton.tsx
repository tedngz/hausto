// Add a listing to the viewing shortlist.
//
// Only ever rendered for crawled listings. The viewing flow requests viewings
// against `external_properties`, and an internal listing has its own booking
// path - offering this on one would produce a request the intake function
// rejects, which is a worse outcome than not offering it.

import { Check, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { useShortlist, MAX_SHORTLIST } from '@/hooks/useShortlist';

interface ShortlistButtonProps {
  listingId: string;
  title: string;
  imageUrl?: string | null;
  /** `sm` on a card, `default` on the listing page. */
  size?: 'sm' | 'default';
  className?: string;
}

export function ShortlistButton({
  listingId,
  title,
  imageUrl,
  size = 'sm',
  className,
}: ShortlistButtonProps) {
  const shortlist = useShortlist();
  const added = shortlist.has(listingId);

  const onClick = (e: React.MouseEvent) => {
    // Cards are clickable surfaces of their own, and this sits inside one.
    e.preventDefault();
    e.stopPropagation();

    const result = shortlist.toggle({ listingId, title, imageUrl: imageUrl ?? null });
    if (!result.ok) {
      toast({ title: 'Shortlist full', description: result.error, variant: 'destructive' });
      return;
    }
    toast({
      title: added ? 'Removed from shortlist' : 'Added to shortlist',
      description: added
        ? undefined
        : `${shortlist.entries.length + 1} of ${MAX_SHORTLIST}. Request viewings when you have three.`,
    });
  };

  return (
    <Button
      type="button"
      size={size === 'sm' ? 'sm' : 'default'}
      variant={added ? 'secondary' : 'outline'}
      onClick={onClick}
      className={className}
      aria-pressed={added}
    >
      {added ? <Check className="mr-1.5 h-4 w-4" /> : <Plus className="mr-1.5 h-4 w-4" />}
      {added ? 'Shortlisted' : 'Shortlist'}
    </Button>
  );
}
