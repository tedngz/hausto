import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePass } from '@/hooks/usePass';
import { useViewingQuota } from '@/hooks/useViewingQuota';
import { CheckCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

// PayPal redirects here after the renter approves a Hausto Pass or a viewing
// top-up (?token=<orderId>). Which one it was is decided server-side from the
// captured amount, so this page reports back rather than assuming.
const PassSuccess = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { refetchPass } = usePass();
  const { refetchQuota } = useViewingQuota();
  const [status, setStatus] = useState<'capturing' | 'success' | 'error'>('capturing');
  const [kind, setKind] = useState<'pass' | 'topup'>('pass');
  const capturedRef = useRef(false);

  useEffect(() => {
    const captureOrder = async () => {
      const orderId = searchParams.get('token');
      if (!user || !orderId || capturedRef.current) return;
      capturedRef.current = true;

      try {
        const { data, error } = await supabase.functions.invoke('capture-pass-order', {
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

        // The hub reads both from cache, so the new cover needs a nudge.
        setKind(data?.kind === 'topup' ? 'topup' : 'pass');
        refetchPass();
        refetchQuota();
        setStatus('success');
        toast.success(
          data?.kind === 'topup'
            ? 'Top-up added - 2 more viewing coordination! 🎉'
            : 'Your Hausto Pass is live - 30 days from now! 🎉',
        );
      } catch (err) {
        console.error('Failed to capture pass order:', err);
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
            <h1 className="text-2xl font-bold mb-2">
              {kind === 'topup' ? 'Top-up added! 🎉' : 'Your Pass is live! 🎉'}
            </h1>
            <p className="text-muted-foreground mb-6">
              {kind === 'topup'
                ? '2 more viewing coordination are on your account. They run until your pass ends.'
                : 'Deep vibe analysis, unlimited AI and 3 viewing coordination, for the next 30 days.'}
            </p>
            <Button onClick={() => navigate('/hub')} size="lg">
              Back to your search
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
