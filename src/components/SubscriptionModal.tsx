import { useState, useEffect } from 'react';
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
export const SubscriptionModal = ({
  isOpen,
  onClose,
  reason
}: SubscriptionModalProps) => {
  const {
    checkSubscription
  } = useSubscription();
  const [paypalLoaded, setPaypalLoaded] = useState(false);
  const reasonMessages = {
    views: "You've reached your daily limit of 10 property views.",
    matches: "You've reached your weekly limit of 20 matches.",
    quiz: "You've used both weekly quiz retakes."
  };
  useEffect(() => {
    if (isOpen && !paypalLoaded) {
      const script = document.createElement('script');
      script.src = 'https://www.paypal.com/sdk/js?client-id=Af9M7zFD7HxgpMjHpmRHK7AhVEF0NSTan-3UXW5CRJA8OsT1A2p2D6hWFv6r049S4Bc6IrmQDsw9q3t_&vault=true&intent=subscription';
      script.onload = () => {
        setPaypalLoaded(true);
        initializePayPalButton();
      };
      document.body.appendChild(script);
      return () => {
        const existingScript = document.querySelector('script[src*="paypal.com/sdk"]');
        if (existingScript) {
          document.body.removeChild(existingScript);
        }
      };
    }
  }, [isOpen, paypalLoaded]);
  const initializePayPalButton = () => {
    if ((window as any).paypal) {
      (window as any).paypal.Buttons({
        style: {
          shape: 'pill',
          color: 'white',
          layout: 'vertical',
          label: 'paypal'
        },
        createSubscription: function (data: any, actions: any) {
          return actions.subscription.create({
            plan_id: 'P-3RL93059D68804616NCU6CSI'
          });
        },
        onApprove: function (data: any, actions: any) {
          toast.success('Subscription activated! You now have premium access.');
          checkSubscription(); // Refresh subscription status
          onClose(); // Close the modal
        },
        onError: function (err: any) {
          toast.error('Payment failed. Please try again.');
          console.error('PayPal error:', err);
        }
      }).render('#paypal-button-container-P-3RL93059D68804616NCU6CSI');
    }
  };
  const freeFeatures = ['10 property views per day', '20 matches per week', '10 AI searches per day'];
  const premiumFeatures = ['Unlimited property views', 'Unlimited matches', 'Unlimited quiz retakes', 'Advanced search filters', 'Priority customer support', 'Early access to new features'];
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
              <CardDescription>Unlimited access to everything</CardDescription>
              <div className="text-2xl sm:text-3xl font-bold">$10/month<span className="text-sm font-normal">/month</span></div>
            </CardHeader>
            <CardContent className="pt-0">
              <ul className="space-y-2 sm:space-y-3 mb-4 sm:mb-6">
                {premiumFeatures.map((feature, index) => <li key={index} className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary shrink-0" />
                    <span className="text-xs sm:text-sm font-medium">{feature}</span>
                  </li>)}
              </ul>
              <div className="w-full mt-6">
                <div id="paypal-button-container-P-3RL93059D68804616NCU6CSI"></div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="text-center text-xs sm:text-sm text-muted-foreground mt-4 px-4">
          <p>✓ Cancel anytime • ✓ Secure PayPal payment • ✓ Instant activation</p>
        </div>
      </DialogContent>
    </Dialog>;
};