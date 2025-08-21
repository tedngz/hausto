import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Check, X, Crown } from 'lucide-react';
import { useSubscription } from '@/hooks/useSubscription';
import { toast } from 'sonner';

interface SubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  reason?: 'views' | 'matches' | 'quiz';
}

export const SubscriptionModal = ({ isOpen, onClose, reason }: SubscriptionModalProps) => {
  const { createSubscription, loading } = useSubscription();
  const [upgrading, setUpgrading] = useState(false);

  const reasonMessages = {
    views: "You've reached your daily limit of 10 property views.",
    matches: "You've reached your weekly limit of 20 matches.",
    quiz: "You've used both weekly quiz retakes.",
  };

  const handleUpgrade = async () => {
    setUpgrading(true);
    try {
      const approvalUrl = await createSubscription();
      if (approvalUrl) {
        window.location.href = approvalUrl;
      }
    } catch (error) {
      toast.error('Failed to start upgrade process');
    } finally {
      setUpgrading(false);
    }
  };

  const freeFeatures = [
    '10 property views per day',
    '20 matches per week',
    '2 quiz retakes per week',
    'Basic search filters',
  ];

  const premiumFeatures = [
    'Unlimited property views',
    'Unlimited matches',
    'Unlimited quiz retakes',
    'Advanced search filters',
    'Priority customer support',
    'Early access to new features',
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <Crown className="h-6 w-6 text-primary" />
            Upgrade to Premium
          </DialogTitle>
          <DialogDescription className="text-lg">
            {reason && reasonMessages[reason]}
            {" "}Unlock unlimited access with our premium plan.
          </DialogDescription>
        </DialogHeader>

        <div className="grid md:grid-cols-2 gap-6 mt-6">
          {/* Free Plan */}
          <Card className="relative">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Free Plan
                <Badge variant="secondary">Current</Badge>
              </CardTitle>
              <CardDescription>Perfect for getting started</CardDescription>
              <div className="text-3xl font-bold">$0<span className="text-sm font-normal">/month</span></div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {freeFeatures.map((feature, index) => (
                  <li key={index} className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">{feature}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* Premium Plan */}
          <Card className="relative border-primary bg-primary/5">
            <div className="absolute -top-2 left-1/2 -translate-x-1/2">
              <Badge className="bg-primary text-primary-foreground">Recommended</Badge>
            </div>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Crown className="h-5 w-5 text-primary" />
                Premium Plan
              </CardTitle>
              <CardDescription>Unlimited access to everything</CardDescription>
              <div className="text-3xl font-bold">$5<span className="text-sm font-normal">/month</span></div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {premiumFeatures.map((feature, index) => (
                  <li key={index} className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">{feature}</span>
                  </li>
                ))}
              </ul>
              <Button 
                onClick={handleUpgrade}
                disabled={upgrading || loading}
                className="w-full mt-6 bg-primary hover:bg-primary/90"
                size="lg"
              >
                {upgrading ? 'Processing...' : 'Upgrade Now'}
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="text-center text-sm text-muted-foreground mt-4">
          <p>✓ Cancel anytime • ✓ Secure PayPal payment • ✓ Instant activation</p>
        </div>
      </DialogContent>
    </Dialog>
  );
};