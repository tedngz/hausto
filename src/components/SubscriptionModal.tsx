import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Check, Crown } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { useViewingQuota } from '@/hooks/useViewingQuota';
import { toast } from 'sonner';
interface SubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  reason?: 'views' | 'matches' | 'quiz';
}
export const SubscriptionModal = ({
  isOpen,
  onClose,
  reason
}: SubscriptionModalProps) => {
  const {
    user
  } = useAuth();
  const {
    createSubscription
  } = useSubscription();
  const { quota, purchaseUnlimitedMonth } = useViewingQuota();
  const [loading, setLoading] = useState(false);
  const [addonLoading, setAddonLoading] = useState(false);
  const reasonMessages = {
    views: "You've reached your daily limit of 10 swipes.",
    matches: "You've reached your weekly limit of 20 matches.",
    quiz: "You've used both weekly quiz retakes."
  };
  const handleGoPremium = async () => {
    if (!user) {
      toast.error('Please log in to upgrade to premium');
      return;
    }
    setLoading(true);
    try {
      const approvalUrl = await createSubscription();
      if (approvalUrl) {
        // Redirect to PayPal checkout
        window.location.href = approvalUrl;
      } else {
        toast.error('Failed to create subscription. Please try again.');
      }
    } catch (error: any) {
      console.error('Error creating subscription:', error);
      toast.error('Failed to process payment. Please try again.');
    } finally {
      setLoading(false);
    }
  };
  const handleBuyAddon = async () => {
    if (!user) {
      toast.error('Please log in to purchase the add-on');
      return;
    }
    setAddonLoading(true);
    try {
      await purchaseUnlimitedMonth();
    } finally {
      setAddonLoading(false);
    }
  };
  const freeFeatures = ['10 swipes per day', '20 matches per week', '10 AI searches per day'];
  const premiumFeatures = [
    'Unlimited swipes',
    'Unlimited matches',
    'Unlimited AI searches',
    'Fast-Track: Hausto coordinates with realtors/owners to schedule up to 3 viewings per month for you',
  ];
  return <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl sm:text-2xl">
            <Crown className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            Upgrade to Premium
          </DialogTitle>
          <DialogDescription className="text-sm sm:text-lg">
            {reason && reasonMessages[reason]}
            {" "}Unlock unlimited access with our premium plan.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 mt-4 sm:mt-6">
          {/* Free Plan */}
          <Card className="relative">
            <CardHeader className="pb-4">
              <CardTitle className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                <span>Free Plan</span>
                <Badge variant="secondary">Current</Badge>
              </CardTitle>
              <CardDescription>Perfect for getting started</CardDescription>
              <div className="text-2xl sm:text-3xl font-bold">$0<span className="text-sm font-normal">/month</span></div>
            </CardHeader>
            <CardContent className="pt-0">
              <ul className="space-y-2 sm:space-y-3">
                {freeFeatures.map((feature, index) => <li key={index} className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-xs sm:text-sm">{feature}</span>
                  </li>)}
              </ul>
            </CardContent>
          </Card>

          {/* Premium Plan */}
          <Card className="relative border-primary bg-primary/5">
            <div className="absolute -top-2 left-1/2 -translate-x-1/2">
              <Badge className="bg-primary text-primary-foreground">Recommended</Badge>
            </div>
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2">
                <Crown className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
                Premium Plan
              </CardTitle>
              <CardDescription>Unlimited search, plus Fast-Track viewings</CardDescription>
              <div className="text-2xl sm:text-3xl font-bold">$10<span className="text-sm font-normal">/month</span></div>
              
            </CardHeader>
            <CardContent className="pt-0">
              <ul className="space-y-2 sm:space-y-3 mb-4 sm:mb-6">
                {premiumFeatures.map((feature, index) => <li key={index} className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary shrink-0" />
                    <span className="text-xs sm:text-sm font-medium">{feature}</span>
                  </li>)}
              </ul>
              <Button onClick={handleGoPremium} disabled={loading} className="w-full" size="lg">
                {loading ? 'Processing...' : 'Go Premium'}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Unlimited viewing schedules: sold as a standalone $20 add-on, not bundled into Premium */}
        <Card className="mt-4 sm:mt-6">
          <CardContent className="pt-4 sm:pt-6 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
            <div className="flex-1">
              <div className="font-semibold flex items-center gap-2">
                Unlimited Viewings
                <Badge variant="secondary">$20/month</Badge>
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                Book as many in-person viewings as you need for 30 days. Hausto coordinates every visit until you settle on a home. No Premium plan required.
                {quota?.unlimited && ' Already active on your account.'}
              </p>
            </div>
            <Button
              variant="outline"
              onClick={handleBuyAddon}
              disabled={addonLoading || quota?.unlimited}
              className="shrink-0"
            >
              {addonLoading ? 'Processing...' : quota?.unlimited ? 'Active' : 'Get unlimited viewings'}
            </Button>
          </CardContent>
        </Card>

        <div className="text-center text-xs sm:text-sm text-muted-foreground mt-4 px-4">
          <p>✓ Cancel anytime • ✓ Secure PayPal payment • ✓ Fast activation</p>
        </div>
      </DialogContent>
    </Dialog>;
};