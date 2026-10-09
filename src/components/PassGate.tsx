import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { SubscriptionModal } from '@/components/SubscriptionModal';
import { PASS_MODAL_EVENT, type PassModalDetail } from '@/lib/passEvents';

/**
 * "Get the Pass", fired from anywhere in the app, answered in one place.
 *
 * The pages that own a paywall already mount their own SubscriptionModal and
 * pass a callback down. That works while the ask lives on the page; it stops
 * working once a leaf component several levels down - the Deep scan chip on a
 * property card - has to raise it, because the card is rendered by browse, the
 * swipe deck, matches, Hausto Agent, complex pages and the listing page, and
 * only some of them have a modal to hand it.
 *
 * So the ask travels as an event, the way "ask the AI about this" does, and
 * this listens for it app-wide. Pages keep their own modals: this is the
 * fallback for the surfaces that have none, not a replacement.
 *
 * Signed-out visitors go to sign-in rather than the plan: a pass is bought
 * against an account, so selling one first would strand them at checkout.
 */
export const PassGate = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [reason, setReason] = useState<PassModalDetail['reason']>();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<PassModalDetail>).detail;
      if (!user) {
        navigate('/auth', { state: { returnTo: window.location.pathname } });
        return;
      }
      setReason(detail?.reason);
      setOpen(true);
    };

    window.addEventListener(PASS_MODAL_EVENT, onRequest);
    return () => window.removeEventListener(PASS_MODAL_EVENT, onRequest);
  }, [user, navigate]);

  return <SubscriptionModal isOpen={open} onClose={() => setOpen(false)} reason={reason} />;
};
