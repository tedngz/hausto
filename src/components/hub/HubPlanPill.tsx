import { ChevronDown, Crown, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { UsageMeter } from '@/components/UsageMeter';
import { usePass } from '@/hooks/usePass';
import { cn } from '@/lib/utils';

interface HubPlanPillProps {
  onOpenSubscription: () => void;
}

/**
 * The renter's plan, in the top bar beside the account menu, with the usage
 * numbers one tap away - so a quota wall raised anywhere on the hub has
 * somewhere visible to point. Signed-in only; the caller decides that.
 */
export const HubPlanPill = ({ onOpenSubscription }: HubPlanPillProps) => {
  const { pass } = usePass();
  // Cover comes from the Pass, not the retired $10/mo plan: reading
  // subscription state here left every pass holder - bought or complimentary -
  // looking at a "Free" chip in the hub.
  const hasPass = !!pass?.active;
  const Icon = hasPass ? Crown : Zap;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={hasPass ? 'Hausto Pass - see usage' : 'Free plan - see usage'}
          className={cn(
            'h-9 gap-1.5 rounded-full border px-3 text-xs font-semibold',
            hasPass
              ? 'border-primary/25 bg-primary/[0.06] text-primary hover:bg-primary/10 hover:text-primary'
              : 'border-border bg-white text-foreground hover:bg-secondary',
          )}
        >
          <Icon className={cn('h-3.5 w-3.5', !hasPass && 'text-primary')} aria-hidden="true" />
          {hasPass ? 'Pass' : 'Free'}
          <ChevronDown className="h-3 w-3 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] space-y-3 p-3">
        {/* Deliberately just the numbers and the action - what the plan
            includes belongs on the profile page, not in a popover someone
            opened to check how much they have left. */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">{hasPass ? 'Hausto Pass' : 'Free plan'}</span>
          {/* A complimentary pass has no end date to count down to. */}
          {hasPass && (
            <span className="text-[11px] text-muted-foreground">
              {pass!.isComplimentary
                ? 'Included with your admin account'
                : `${pass!.daysLeft} day${pass!.daysLeft === 1 ? '' : 's'} left`}
            </span>
          )}
        </div>

        <UsageMeter />

        {!hasPass && (
          <Button className="w-full" size="sm" onClick={onOpenSubscription}>
            <Crown className="h-3.5 w-3.5" aria-hidden="true" />
            Get the Pass
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
};
