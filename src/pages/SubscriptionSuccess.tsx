import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { CheckCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const SubscriptionSuccess = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [status, setStatus] = useState<'activating' | 'success' | 'error'>('activating');

  useEffect(() => {
    const activateSubscription = async () => {
      const subscriptionId = searchParams.get('subscription_id');
      
      if (!user) {
        // Wait for auth to load
        return;
      }

      try {
        const { data, error } = await supabase.functions.invoke('activate-paypal-subscription', {
          headers: {
            Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
          body: { subscription_id: subscriptionId },
        });

        if (error || data?.error) {
          console.error('Activation error:', error || data?.error);
          setStatus('error');
          return;
        }

        setStatus('success');
        toast.success('Welcome to Premium! 🎉');
      } catch (err) {
        console.error('Failed to activate subscription:', err);
        setStatus('error');
      }
    };

    if (user) {
      activateSubscription();
    }
  }, [user, searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="text-center max-w-md">
        {status === 'activating' && (
          <>
            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
            <h1 className="text-2xl font-bold mb-2">Activating your subscription...</h1>
            <p className="text-muted-foreground">Please wait while we confirm your payment.</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle className="h-16 w-16 text-primary mx-auto mb-4" />
            <h1 className="text-2xl font-bold mb-2">You're now Premium! 🎉</h1>
            <p className="text-muted-foreground mb-6">Enjoy unlimited access to all features.</p>
            <Button onClick={() => navigate('/')} size="lg">
              Start Exploring
            </Button>
          </>
        )}
        {status === 'error' && (
          <>
            <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
            <p className="text-muted-foreground mb-6">
              Your payment was received but activation failed. Don't worry — your subscription will be activated shortly.
            </p>
            <Button onClick={() => navigate('/')} size="lg">
              Go Home
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

export default SubscriptionSuccess;
