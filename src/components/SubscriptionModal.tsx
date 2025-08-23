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
                {freeFeatures.map((feature, index) => (
                  <li key={index} className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-xs sm:text-sm">{feature}</span>
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
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2">
                <Crown className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
                Premium Plan
              </CardTitle>
              <CardDescription>Unlimited access to everything</CardDescription>
              <div className="text-2xl sm:text-3xl font-bold">$5<span className="text-sm font-normal">/month</span></div>
            </CardHeader>
            <CardContent className="pt-0">
              <ul className="space-y-2 sm:space-y-3 mb-4 sm:mb-6">
                {premiumFeatures.map((feature, index) => (
                  <li key={index} className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary shrink-0" />
                    <span className="text-xs sm:text-sm font-medium">{feature}</span>
                  </li>
                ))}
              </ul>
              <div className="w-full mt-6">
                <style dangerouslySetInnerHTML={{
                  __html: `.pp-8E258XS72JNSU{text-align:center;border:none;border-radius:0.25rem;min-width:11.625rem;padding:0 2rem;height:2.625rem;font-weight:bold;background-color:#FFD140;color:#000000;font-family:"Helvetica Neue",Arial,sans-serif;font-size:1rem;line-height:1.25rem;cursor:pointer;}`
                }} />
                <form action="https://www.paypal.com/ncp/payment/8E258XS72JNSU" method="post" target="_blank" style={{display:'inline-grid', justifyItems:'center', alignContent:'start', gap:'0.5rem', width:'100%'}}>
                  <input className="pp-8E258XS72JNSU" type="submit" value="Buy Now" style={{width:'100%'}} />
                  <img src="https://www.paypalobjects.com/images/Debit_Credit.svg" alt="cards" />
                  <section style={{fontSize: '0.75rem'}}> 
                    Powered by <img src="https://www.paypalobjects.com/paypal-ui/logos/svg/paypal-wordmark-color.svg" alt="paypal" style={{height:'0.875rem', verticalAlign:'middle'}}/>
                  </section>
                </form>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="text-center text-xs sm:text-sm text-muted-foreground mt-4 px-4">
          <p>✓ Cancel anytime • ✓ Secure PayPal payment • ✓ Instant activation</p>
        </div>
      </DialogContent>
    </Dialog>
  );
};