import { cn } from '@/lib/utils';

/**
 * The refund promise, beside the price wherever the Pass is bought for
 * viewings: the Pass modal, the lock-in page and Request viewing's Pass card.
 * Not on the Priority search pitch - a search that finds nothing is not
 * covered, and this line there would read as if it were. The policy is
 * /terms; its first line is this one.
 *
 * The policy opens in a new tab: each of these sits mid-purchase, in a modal
 * or on a page holding a plan, and following a link away would lose it.
 */
export const RefundPromise = ({ className }: { className?: string }) => (
  <p className={cn('text-xs text-muted-foreground', className)}>
    Money back if we can't get you a single viewing.{' '}
    <a
      href="/terms"
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2 hover:text-foreground"
    >
      Refund policy
    </a>
  </p>
);
