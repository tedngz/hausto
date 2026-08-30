import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Check, Crown } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { VIEWINGS_PER_PACK, useViewingQuota } from '@/hooks/useViewingQuota';
import { toast } from 'sonner';
interface SubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  reason?: 'matches' | 'quiz' | 'viewings';
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
  const { quota, purchaseViewingPack } = useViewingQuota();
  const [loading, setLoading] = useState(false);
  const [addonLoading, setAddonLoading] = useState(false);
  const reasonMessages = {
    matches: "You've reached your weekly limit of 20 matches.",
    quiz: "You've used both weekly quiz retakes.",
    viewings: "You've used your free viewing coordination."
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
      await purchaseViewingPack();
    } finally {
      setAddonLoading(false);
    }
  };
  const freeFeatures = [
    '20 matches per week',
    '10 AI searches per day',
    quota?.trialUsed
      ? '1 free viewing coordination (used)'
      : '1 free viewing coordination - we book it for you',
  ];
  const premiumFeatures = [
    'Unlimited matches',
    'Unlimited AI searches',
    '3 viewing coordination',
  ];
  return <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl sm:text-2xl">
            <Crown className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            Upgrade to Premium
          </DialogTitle>
          {/* Only speaks up when there's a reason the renter landed here. */}
          <DialogDescription className={`text-sm sm:text-lg ${reason ? '' : 'sr-only'}`}>
            {reason ? reasonMessages[reason] : 'Compare the Hausto plans.'}
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
              <CardDescription>Unlimited search, plus viewing coordination</CardDescription>
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

        {/* The viewing pack: a standalone one-off $20 purchase, not bundled into Premium */}
        <Card className="mt-4 sm:mt-6">
          <CardContent className="pt-4 sm:pt-6 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
            <div className="flex-1">
              <div className="font-semibold flex items-center gap-2">
                Viewing Pack
                <Badge variant="secondary">$20 one-off</Badge>
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                {VIEWINGS_PER_PACK} viewing coordination, good for 30 days. No Premium plan required.
                {/* Packs stack, so the pitch is "buy another", never "already active". */}
                {!!quota?.packRemaining && (
                  <>
                    {' '}
                    {quota.packRemaining} left on your account
                    {quota.packExpiresAt
                      ? ` until ${new Date(quota.packExpiresAt).toLocaleDateString()}`
                      : ''}
                    .
                  </>
                )}
              </p>
            </div>
            <Button
              variant="outline"
              onClick={handleBuyAddon}
              disabled={addonLoading}
              className="shrink-0"
            >
              {addonLoading ? 'Processing...' : quota?.hasPack ? 'Buy another pack' : 'Get the viewing pack'}
            </Button>
          </CardContent>
        </Card>

        <div className="text-center text-xs sm:text-sm text-muted-foreground mt-4 px-4">
          <p>✓ Cancel anytime • ✓ Secure PayPal payment • ✓ Fast activation</p>
        </div>
      </DialogContent>
    </Dialog>;
};