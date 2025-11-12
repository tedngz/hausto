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
    loading,
    checkSubscription,
    cancelSubscription
  } = useSubscription();
  const [cancelling, setCancelling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const isPremium = subscribed === true || subscription_tier === 'premium';

  // Debug logging - more detailed
  console.log('Subscription Status Debug:', {
    subscribed,
    subscription_tier,
    subscription_end,
    isPremium,
    loading,
    subscribedType: typeof subscribed,
    tierType: typeof subscription_tier
  });
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
    <Card>
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
              {subscribed ? 'Renews' : 'Effective until'} {new Date(subscription_end).toLocaleDateString()}
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
            
            {subscribed ? <Button variant="outline" onClick={handleCancelClick} disabled={cancelling} className="w-full h-9 text-sm" size="sm">
                <CreditCard className="h-3.5 w-3.5 mr-1.5" />
                {cancelling ? 'Cancelling...' : 'Cancel Subscription'}
              </Button> : <Button onClick={onUpgrade} className="w-full h-9 text-sm" size="sm">
                <Crown className="h-3.5 w-3.5 mr-1.5" />
                Reactivate Subscription
              </Button>}
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