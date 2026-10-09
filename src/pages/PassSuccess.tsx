import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePass } from '@/hooks/usePass';
import { CheckCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

// Polar redirects here after the renter pays for a Hausto Pass
// (?checkout_id=<id>, and &ref=<plan> when it was bought to lock a plan in).
// What was bought - and whether its plan was locked in - is decided
// server-side, where the purchase is recorded (_shared/polar-pass.ts), so this
// page reports back rather than assuming. A renter who closed the tab instead
// still has the Pass and the plan: the webhook records both.
const PassSuccess = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { refetchPass } = usePass();
  const [status, setStatus] = useState<'capturing' | 'success' | 'pending' | 'error'>('capturing');
  const [kind, setKind] = useState<'pass' | 'topup'>('pass');
  const [lockIn, setLockIn] = useState<{ ref: string | null; lockedIn: boolean } | null>(null);
  /** Offered when the account has no WhatsApp number to send anything to. */
  const [whatsappLink, setWhatsappLink] = useState<string | null>(null);
  const capturedRef = useRef(false);
  const planRef = searchParams.get('ref');

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

        // A top-up bought before it was retired still records here.
        setKind(data?.kind === 'topup' ? 'topup' : 'pass');
        setLockIn(data?.lockIn ?? null);
        setWhatsappLink(data?.whatsappLink ?? null);
        refetchPass();
        setStatus('success');
        toast.success(
          data?.lockIn?.lockedIn
            ? 'Your Pass is live and your plan is locked in.'
            : 'Your Hausto Pass is live for 30 days.',
        );
      } catch (err) {
        console.error('Failed to capture pass order:', err);
        setStatus('error');
      }
    };

    captureOrder();
    // capturedRef, not this list, keeps it to one capture: a re-run returns
    // before it reaches the payment.
  }, [user, searchParams, refetchPass]);

  const ref = lockIn?.ref ?? planRef;

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
              {kind === 'topup' ? 'Top-up added' : lockIn?.lockedIn ? 'Your plan is locked in' : 'Your Pass is live'}
            </h1>
            <p className="text-muted-foreground mb-6">
              {kind === 'topup'
                ? 'It runs until your pass ends.'
                : lockIn?.lockedIn
                  ? 'We tell the agents to expect you, and on the morning of each viewing we send where to meet on WhatsApp. Your Pass covers every viewing we arrange for the next 30 days.'
                  : lockIn
                    ? `Your Pass is live, but ${lockIn.ref ?? 'that plan'} could not be locked in - its time had passed. We will be in touch about it.`
                    : 'Every viewing we arrange, unlimited AI and Deep scan, for the next 30 days.'}
            </p>
            {whatsappLink && (
              <div className="mb-6 rounded-md border p-4 text-left text-sm">
                <p className="font-medium">One more step: link your WhatsApp</p>
                <p className="mt-1 text-muted-foreground">
                  Your plans, and the new places you asked for, come on WhatsApp. Send us the message this opens.
                </p>
                <Button asChild className="mt-3 w-full">
                  <a href={whatsappLink} target="_blank" rel="noreferrer">Open WhatsApp</a>
                </Button>
              </div>
            )}
            {ref && !lockIn?.lockedIn && lockIn === null ? (
              <Button onClick={() => navigate(`/lock-in/${ref}`)} size="lg">Back to your plan</Button>
            ) : (
              <Button onClick={() => navigate(ref && lockIn?.lockedIn ? `/lock-in/${ref}` : '/hub')} size="lg">
                {ref && lockIn?.lockedIn ? 'See your plan' : 'Back to your search'}
              </Button>
            )}
          </>
        )}
        {status === 'pending' && (
          <>
            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
            <h1 className="text-2xl font-bold mb-2">Your payment is going through</h1>
            <p className="text-muted-foreground mb-6">
              We have your payment - it just needs a moment to settle. Refresh this page in a few
              seconds and your pass will be there{planRef ? ', with your plan held for it' : ''}.
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
