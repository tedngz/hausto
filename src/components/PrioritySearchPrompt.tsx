import { useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConciergeCaptureModal, type SearchPrefill } from '@/components/ConciergeCaptureModal';
import { cn } from '@/lib/utils';
import { REPLY_WITHIN_HOURS } from '../../supabase/functions/_shared/viewing/place.ts';

/**
 * Priority search, offered under a thin search (the pricing rework, step 5):
 * in Browse when the filters leave little, and in the chat when a search
 * found little - prefilled from that search either way. The modal decides
 * what the renter sees next: sign in, the Pass, or the form.
 */
export function PrioritySearchPrompt({ prefill, found, className }: {
  prefill: SearchPrefill;
  /** How many places the search showed; fewer than THIN_SEARCH. */
  found: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn('flex flex-col gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center', className)}>
      <div className="flex-1 text-left">
        <p className="text-sm font-medium">{found === 0 ? 'Nothing here that fits?' : 'Only a few here?'} We can look for you.</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Our team finds places that fit and sends them on WhatsApp within {REPLY_WITHIN_HOURS.AREA} hours.
          Comes with the Pass.
        </p>
      </div>
      <Button size="sm" className="shrink-0" onClick={() => setOpen(true)}>
        <Search className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
        Start a priority search
      </Button>
      <ConciergeCaptureModal open={open} onOpenChange={setOpen} search={prefill} />
    </div>
  );
}
