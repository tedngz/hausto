import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePass } from '@/hooks/usePass';
import { useViewingQuota } from '@/hooks/useViewingQuota';
import { CheckCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

// Polar redirects here after the renter pays for a Hausto Pass or a viewing
// top-up (?checkout_id=<id>). Which one it was is decided server-side from the
// checkout's metadata, so this page reports back rather than assuming.
const PassSuccess = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { refetchPass } = usePass();
  const { refetchQuota } = useViewingQuota();
  const [status, setStatus] = useState<'capturing' | 'success' | 'pending' | 'error'>('capturing');
  const [kind, setKind] = useState<'pass' | 'topup'>('pass');
  const capturedRef = useRef(false);

  useEffect(() => {
    const captureOrder = async () => {
      const checkoutId = searchParams.get('checkout_id');
      if (!user || !checkoutId || capturedRef.current) return;
      capturedRef.current = true;

      try {
        const { data, error } = await supabase.functions.invoke('capture-pass-order', {
          headers: {
            Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
          body: { checkoutId },
        });

        if (error || data?.error) {
          console.error('Capture error:', error || data?.error);
          setStatus('error');
          return;
        }

        // Polar has the money but hasn't finished settling the session. Nothing
        // is lost - reloading calls this again with the same checkout id - so
        // say so rather than claiming a failure.
        if (data?.pending) {
          setStatus('pending');
          return;
        }

        // The hub reads both from cache, so the new cover needs a nudge.
        setKind(data?.kind === 'topup' ? 'topup' : 'pass');
        refetchPass();
        refetchQuota();
        setStatus('success');
        toast.success(
          data?.kind === 'topup'
            ? 'Top-up added - 2 more viewing requests! 🎉'
            : 'Your Hausto Pass is live - 30 days from now! 🎉',
        );
      } catch (err) {
        console.error('Failed to capture pass order:', err);
        setStatus('error');
      }
    };

    captureOrder();
    // capturedRef, not this list, keeps it to one capture: a re-run returns
    // before it reaches the payment.
  }, [user, searchParams, refetchPass, refetchQuota]);

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
            <h1 className="text-2xl font-bold mb-2">
              {kind === 'topup' ? 'Top-up added! 🎉' : 'Your Pass is live! 🎉'}
            </h1>
            <p className="text-muted-foreground mb-6">
              {kind === 'topup'
                ? '2 more viewing requests are on your account. They run until your pass ends.'
                : 'Deep vibe analysis, unlimited AI and 3 viewing requests, for the next 30 days.'}
            </p>
            <Button onClick={() => navigate('/hub')} size="lg">
              Back to your search
            </Button>
          </>
        )}
        {status === 'pending' && (
          <>
            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
            <h1 className="text-2xl font-bold mb-2">Your payment is going through</h1>
            <p className="text-muted-foreground mb-6">
              We have your payment - it just needs a moment to settle. Refresh this page in a few
              seconds and your pass will be there.
            </p>
            <Button onClick={() => window.location.reload()} size="lg">
              Refresh
            </Button>
          </>
        )}
        {status === 'error' && (
          <>
            <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
            <p className="text-muted-foreground mb-6">
              If you completed the payment, your pass will appear shortly - contact us if it doesn't.
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

export default PassSuccess;
