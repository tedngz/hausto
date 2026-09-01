import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Crown, RefreshCw } from 'lucide-react';
import { useSubscription } from '@/hooks/useSubscription';
import { usePass, PASS_PRICE_USD, PASS_DAYS } from '@/hooks/usePass';
import { useViewingQuota } from '@/hooks/useViewingQuota';
import { useState } from 'react';
import { toast } from 'sonner';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

interface SubscriptionStatusProps {
  onUpgrade?: () => void;
  showHistory?: boolean;
}

/**
 * Where the renter stands right now, in two lines and one button.
 *
 * The plan comparison lives in the upgrade modal, so this card doesn't repeat
 * it - it answers "what have I got left, and what do I press next".
 */
export const SubscriptionStatus = ({ onUpgrade }: SubscriptionStatusProps) => {
  const {
    paypal_subscription_id,
    is_suspended,
    loading,
    checkSubscription,
    cancelSubscription
  } = useSubscription();
  const { pass } = usePass();
  const { quota } = useViewingQuota();
  const [cancelling, setCancelling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);

  const active = !!pass?.active;
  // Nothing recurs on the Pass, so a cancel button only makes sense for the
  // retired $10/mo plan while its PayPal subscription is still live.
  const canCancelLegacy = active && pass.isLegacySubscription && !!paypal_subscription_id && !is_suspended;

  const handleRefresh = async () => {
    setRefreshing(true);
    await checkSubscription();
    setRefreshing(false);
    toast.success('Plan status refreshed');
  };

  const handleConfirmCancel = async () => {
    setShowCancelDialog(false);
    setCancelling(true);
    await cancelSubscription();
    setCancelling(false);
  };

  if (loading) {
    return <Card>
        <CardContent className="p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-muted rounded w-1/2"></div>
            <div className="h-8 bg-muted rounded w-1/4"></div>
          </div>
        </CardContent>
      </Card>;
  }

  const viewingsLine = quota
    ? `${quota.remaining} viewing coordination left`
    : null;

  return <>
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2 text-lg">
            {active && <Crown className="h-4 w-4 text-primary" />}
            {active ? 'Hausto Pass' : 'Free plan'}
          </span>
          <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={refreshing} className="h-8 w-8 p-0">
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {active ? <>
            <p className="text-sm text-muted-foreground">
              {/* A complimentary pass has no end date, so there is nothing to count down to - and nothing to extend. */}
              {pass.isComplimentary
                ? 'Included with your admin account'
                : `${pass.daysLeft} day${pass.daysLeft === 1 ? '' : 's'} left`}
              {viewingsLine ? ` · ${viewingsLine}` : ''}
            </p>
            {/* A complimentary pass has no cycle to extend, but its holder
                still needs the way in to top up viewings - so the button
                changes what it offers rather than disappearing. */}
            <Button onClick={onUpgrade} className="w-full h-9 text-sm" size="sm">
              {pass.isComplimentary ? 'Buy more viewings' : `Extend by ${PASS_DAYS} days`}
            </Button>
            {canCancelLegacy && (
              <Button variant="ghost" onClick={() => setShowCancelDialog(true)} disabled={cancelling} className="w-full h-8 text-xs text-muted-foreground" size="sm">
                {cancelling ? 'Cancelling...' : 'Cancel old monthly plan'}
              </Button>
            )}
          </> : <>
            <p className="text-sm text-muted-foreground">
              {quota?.trialAvailable
                ? 'Your first viewing is on us. The Pass adds 3 more, plus a Deep Scan on any listing before you spend a Saturday on it.'
                : quota?.trialLocked
                  ? 'Answer the preference quiz and match 3 listings to unlock your free viewing coordination.'
                  : 'Free viewing coordination used. The Pass unlocks Deep Scan and 3 more viewings.'}
            </p>
            <Button onClick={onUpgrade} className="w-full h-9 text-sm" size="sm">
              <Crown className="h-3.5 w-3.5 mr-1.5" />
              Get the Pass - ${PASS_PRICE_USD} for {PASS_DAYS} days
            </Button>
          </>}
      </CardContent>
    </Card>

    <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel your monthly plan?</AlertDialogTitle>
          <AlertDialogDescription>
            Your benefits stay active until {pass?.expiresAt ? new Date(pass.expiresAt).toLocaleDateString() : 'the end of the current cycle'}. After that you'll be back on the free plan - the Pass is always there if you need another search.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirmCancel} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            Cancel plan
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
};
