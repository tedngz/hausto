import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useViewingQuota } from '@/hooks/useViewingQuota';
import { CheckCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

// PayPal redirects here after the renter approves a $20 viewing-pack order
// (?token=<orderId>). We capture the payment and record the pack: 10 credits,
// good for 30 days.
const AddonSuccess = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { refetchQuota } = useViewingQuota();
  const [status, setStatus] = useState<'capturing' | 'success' | 'error'>('capturing');
  const capturedRef = useRef(false);

  useEffect(() => {
    const captureOrder = async () => {
      const orderId = searchParams.get('token');
      if (!user || !orderId || capturedRef.current) return;
      capturedRef.current = true;

      try {
        const { data, error } = await supabase.functions.invoke('capture-viewing-addon-order', {
          headers: {
            Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
          body: { orderId },
        });

        if (error || data?.error) {
          console.error('Capture error:', error || data?.error);
          setStatus('error');
          return;
        }

        // The hub reads the quota from cache, so the new credits need a nudge.
        refetchQuota();
        setStatus('success');
        toast.success('Viewing pack added - 10 coordination for the next 30 days! 🎉');
      } catch (err) {
        console.error('Failed to capture add-on order:', err);
        setStatus('error');
      }
    };

    captureOrder();
  }, [user, searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="text-center max-w-md">
        {status === 'capturing' && (
          <>
            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
            <h1 className="text-2xl font-bold mb-2">Confirming your purchase...</h1>
            <p className="text-muted-foreground">Please wait while we confirm your payment.</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle className="h-16 w-16 text-primary mx-auto mb-4" />
            <h1 className="text-2xl font-bold mb-2">Viewing pack added! 🎉</h1>
            <p className="text-muted-foreground mb-6">
              10 viewing coordination are now on your account, good for the next 30 days. You can buy another pack whenever you run out.
            </p>
            <Button onClick={() => navigate('/hub')} size="lg">
              Book a viewing
            </Button>
          </>
        )}
        {status === 'error' && (
          <>
            <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
            <p className="text-muted-foreground mb-6">
              If you completed the payment, your pack will appear shortly — contact us if it doesn't.
            </p>
            <Button onClick={() => navigate('/hub')} size="lg">
              Back to your search
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

export default AddonSuccess;
