import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Check, Crown } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  PASS_DAYS,
  PASS_PRICE_USD,
  TOPUP_PRICE_USD,
  TOPUP_VIEWINGS,
  usePass,
} from '@/hooks/usePass';
import { useViewingQuota } from '@/hooks/useViewingQuota';
import { toast } from 'sonner';
interface SubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Matches and quiz retakes no longer have a ceiling, so neither can send anyone here. */
  reason?: 'viewings' | 'ai';
}
export const SubscriptionModal = ({
  isOpen,
  onClose,
  reason
}: SubscriptionModalProps) => {
  const {
    user
  } = useAuth();
  const { pass, purchasePass, purchaseTopUp } = usePass();
  const { quota } = useViewingQuota();
  const [loading, setLoading] = useState(false);
  const [addonLoading, setAddonLoading] = useState(false);
  const reasonMessages = {
    viewings: "You've used your free viewing coordination.",
    ai: "You've used your 10 AI requests for today."
  };
  // Both are one-off PayPal orders now - purchasePass/purchaseTopUp redirect to
  // checkout themselves, so there's no approval URL to handle here.
  const handleGetPass = async () => {
    if (!user) {
      toast.error('Please log in to get the Pass');
      return;
    }
    setLoading(true);
    try {
      await purchasePass();
    } finally {
      setLoading(false);
    }
  };
  const handleTopUp = async () => {
    if (!user) {
      toast.error('Please log in to top up');
      return;
    }
    setAddonLoading(true);
    try {
      await purchaseTopUp();
    } finally {
      setAddonLoading(false);
    }
  };
  // Browsing the curated list, matching and quiz retakes are unlimited on both
  // tiers now, so they're stated once as the shared floor rather than sold.
  const freeFeatures = [
    'Full curated English listing list',
    'Unlimited browsing, matches and quiz retakes',
    'Basic vibe analysis on every listing',
    '10 AI requests per day',
    quota?.trialUsed
      ? '1 free viewing coordination (used)'
      : '1 free viewing coordination - we book it for you',
  ];
  const premiumFeatures = [
    'Everything in Free',
    'Deep read on any listing - design, fit, honest downsides',
    'Neighbourhood and commute rated against your preferences',
    'Unlimited AI requests',
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
                Hausto Pass
              </CardTitle>
              <CardDescription>Unlimited search, plus viewing coordination</CardDescription>
              <div className="text-2xl sm:text-3xl font-bold">
                ${PASS_PRICE_USD}<span className="text-sm font-normal">/{PASS_DAYS} days</span>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <ul className="space-y-2 sm:space-y-3 mb-4 sm:mb-6">
                {premiumFeatures.map((feature, index) => <li key={index} className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary shrink-0" />
                    <span className="text-xs sm:text-sm font-medium">{feature}</span>
                  </li>)}
              </ul>
              <Button onClick={handleGetPass} disabled={loading} className="w-full" size="lg">
                {loading ? 'Processing...' : pass?.active ? 'Extend by 30 days' : 'Get the Pass'}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* The top-up only makes sense on top of a live pass, so it only shows
            there - the $20/10 pack it replaces is retired, though credits
            already bought stay spendable until they lapse. */}
        {pass?.active && (
          <Card className="mt-4 sm:mt-6">
            <CardContent className="pt-4 sm:pt-6 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
              <div className="flex-1">
                <div className="font-semibold flex items-center gap-2">
                  Need more viewings?
                  <Badge variant="secondary">${TOPUP_PRICE_USD} one-off</Badge>
                </div>
                <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                  {TOPUP_VIEWINGS} more viewing coordination, running until your pass ends.
                  {!!quota?.packRemaining && ` ${quota.packRemaining} left on your account.`}
                </p>
              </div>
              <Button
                variant="outline"
                onClick={handleTopUp}
                disabled={addonLoading}
                className="shrink-0"
              >
                {addonLoading ? 'Processing...' : 'Top up'}
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="text-center text-xs sm:text-sm text-muted-foreground mt-4 px-4">
          {/* No "cancel anytime" - nothing recurs, which is the better promise. */}
          <p>✓ One-off payment, nothing recurring • ✓ Secure PayPal payment • ✓ Fast activation</p>
        </div>
      </DialogContent>
    </Dialog>;
};