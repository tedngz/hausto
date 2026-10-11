import { cn } from '@/lib/utils';

/**
 * The refund promise, beside the price wherever the Pass is bought for
 * viewings: the Pass modal, the lock-in page and Request viewing's Pass card.
 * The policy is /terms; its two conditions are this line's.
 *
 * It promises our work, not the agents' answers (2026-10-11): an agent who
 * never replies, cancels or lets the place first is not ours to undo, and a
 * promise tied to how many viewings go ahead sold the Pass as an outcome.
 *
 * The policy opens in a new tab: each of these sits mid-purchase, in a modal
 * or on a page holding a plan, and following a link away would lose it.
 */
export const RefundPromise = ({ className }: { className?: string }) => (
  <p className={cn('text-xs text-muted-foreground', className)}>
    Money back within 7 days if you haven't used it, or if we can't reach the agents within 3 days
    of your request.{' '}
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
