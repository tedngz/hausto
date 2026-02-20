import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Crown, Calendar, RefreshCw, CreditCard } from 'lucide-react';
import { useSubscription } from '@/hooks/useSubscription';
import { useState } from 'react';
import { toast } from 'sonner';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
interface SubscriptionStatusProps {
  onUpgrade?: () => void;
  showHistory?: boolean;
}
export const SubscriptionStatus = ({
  onUpgrade,
  showHistory = false
}: SubscriptionStatusProps) => {
  const {
    subscribed,
    subscription_tier,
    subscription_end,
    paypal_subscription_id,
    is_suspended,
    loading,
    checkSubscription,
    cancelSubscription,
    reactivateSubscription
  } = useSubscription();
  const [cancelling, setCancelling] = useState(false);
  const [reactivating, setReactivating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  // Premium status based on tier and subscription status
  const isPremium = subscription_tier === 'premium' && subscribed;
  
  // Active subscription is ACTIVE on PayPal, suspended means user cancelled but can reactivate
  const hasActiveSubscription = isPremium && !!paypal_subscription_id && !is_suspended;
  const isSuspended = isPremium && is_suspended && !!paypal_subscription_id;
  const isCancelled = isPremium && !paypal_subscription_id;

  const handleReactivate = async () => {
    setReactivating(true);
    const success = await reactivateSubscription();
    setReactivating(false);
    if (!success) {
      // Fallback to creating new subscription
      onUpgrade?.();
    }
  };
  const handleRefresh = async () => {
    setRefreshing(true);
    await checkSubscription();
    setRefreshing(false);
    toast.success('Subscription status refreshed');
  };
  const handleCancelClick = () => {
    setShowCancelDialog(true);
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
  return <>
    <Card className="flex flex-col flex-1">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2 text-lg">
            {isPremium ? <>
                <Crown className="h-4 w-4 text-primary" />
                Premium Plan
              </> : 'Free Plan'}
          </span>
          <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={refreshing} className="h-8 w-8 p-0">
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </CardTitle>
        {isPremium && subscription_end && <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
            <Calendar className="h-3 w-3" />
            <span>
              {(isCancelled || isSuspended) ? 'Cancelled · Effective until' : 'Next billing date:'} {new Date(subscription_end).toLocaleDateString()}
            </span>
          </div>}
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {isPremium ? <div className="space-y-2.5">
            <div className="p-2.5 bg-primary/5 rounded-lg border border-primary/20">
              <div className="text-sm font-medium text-primary mb-1.5">
                Premium Benefits Active
              </div>
              <ul className="text-xs text-muted-foreground space-y-0.5">
                <li>• Unlimited property views</li>
                <li>• Unlimited matches</li>
                <li>• Unlimited AI search</li>
              </ul>
            </div>
            
            {hasActiveSubscription ? <Button variant="outline" onClick={handleCancelClick} disabled={cancelling} className="w-full h-9 text-sm" size="sm">
                <CreditCard className="h-3.5 w-3.5 mr-1.5" />
                {cancelling ? 'Cancelling...' : 'Cancel Subscription'}
              </Button> : isSuspended ? <div className="space-y-2">
                  <Button onClick={handleReactivate} disabled={reactivating} className="w-full h-9 text-sm" size="sm">
                    <Crown className="h-3.5 w-3.5 mr-1.5" />
                    {reactivating ? 'Reactivating...' : 'Reactivate Subscription'}
                  </Button>
                </div> : isCancelled && <div className="space-y-2">
                  <Button onClick={onUpgrade} className="w-full h-9 text-sm" size="sm">
                    <Crown className="h-3.5 w-3.5 mr-1.5" />
                    Reactivate Subscription
                  </Button>
                </div>}
          </div> : <div className="space-y-2.5">
            <p className="text-xs text-muted-foreground">
              Upgrade to unlock unlimited access
            </p>
            <ul className="text-xs text-muted-foreground space-y-0.5">
              <li>• Unlimited property views</li>
              <li>• Unlimited matches</li>
              <li>• Unlimited AI Search</li>
            </ul>
            <Button onClick={onUpgrade} className="w-full h-9 text-sm" size="sm">
              <Crown className="h-3.5 w-3.5 mr-1.5" />
              Upgrade to Premium
            </Button>
          </div>}
      </CardContent>
    </Card>

    <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel Premium Subscription?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>Your premium benefits will remain active until {subscription_end ? new Date(subscription_end).toLocaleDateString() : 'the end of your current billing period'}.</p>
              <p className="text-muted-foreground">After that date, you'll lose access to:</p>
              <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 ml-2">
                <li>Unlimited property views</li>
                <li>Unlimited matches</li>
                <li>Unlimited AI search</li>
              </ul>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep Subscription</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirmCancel} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            Cancel Subscription
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
};