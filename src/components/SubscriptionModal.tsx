import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Check, Crown } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

interface SubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  reason?: 'views' | 'matches' | 'quiz';
}

export const SubscriptionModal = ({ isOpen, onClose, reason }: SubscriptionModalProps) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);

  const reasonMessages = {
    views: "You've reached your daily limit of 10 property views.",
    matches: "You've reached your weekly limit of 20 matches.",
    quiz: "You've used both weekly quiz retakes.",
  };

  const handleGoPremium = async () => {
    if (!user) {
      toast.error('Please log in to upgrade to premium');
      return;
    }

    setLoading(true);
    try {
      console.log('Getting user session...');
      
      // Verify user session is valid
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError || !session) {
        console.error('Session error:', sessionError);
        toast.error('Your session has expired. Please log in again.');
        setLoading(false);
        return;
      }

      console.log('Session valid, fetching profile...');
      
      // Get user profile for name
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('name, email')
        .eq('id', user.id)
        .single();

      if (profileError) {
        console.error('Profile error:', profileError);
      }

      console.log('Invoking edge function...');
      
      const { data, error } = await supabase.functions.invoke('notify-premium-interest', {
        body: {
          userEmail: profile?.email || user.email,
          userName: profile?.name || 'Valued Customer',
        },
      });

      if (error) {
        console.error('Edge function error:', error);
        throw error;
      }

      console.log('Success:', data);

      toast.success(
        'Request received! You will receive a payment request email from Payoneer soon.',
        { duration: 5000 }
      );
      onClose();
    } catch (error: any) {
      console.error('Error requesting premium:', error);
      toast.error(`Failed to process request: ${error.message || 'Please try again.'}`);
    } finally {
      setLoading(false);
    }
  };

  const freeFeatures = [
    '10 property views per day',
    '20 matches per week',
    '10 AI searches per day',
  ];

  const premiumFeatures = [
    'Unlimited property views',
    'Unlimited matches',
    'Unlimited AI Search',
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
              <div className="text-2xl sm:text-3xl font-bold">$10<span className="text-sm font-normal">/month</span></div>
              <p className="text-xs text-muted-foreground mt-1">2-month minimum subscription</p>
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
              <Button 
                onClick={handleGoPremium}
                disabled={loading}
                className="w-full"
                size="lg"
              >
                {loading ? 'Processing...' : 'Go Premium'}
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="text-center text-xs sm:text-sm text-muted-foreground mt-4 px-4">
          <p>✓ Cancel anytime • ✓ Secure Payoneer payment • ✓ Fast activation</p>
        </div>
      </DialogContent>
    </Dialog>
  );
};