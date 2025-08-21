import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export const useSubscription = () => {
  const { user } = useAuth();
  const [subscriptionStatus, setSubscriptionStatus] = useState({
    subscribed: false,
    subscription_tier: 'free',
    subscription_end: null as string | null,
    loading: true,
  });

  const checkSubscription = async () => {
    if (!user) return;

    try {
      setSubscriptionStatus(prev => ({ ...prev, loading: true }));
      
      const { data, error } = await supabase.functions.invoke('check-paypal-subscription', {
        headers: {
          Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        },
      });

      if (error) throw error;

      setSubscriptionStatus({
        subscribed: data.subscribed || false,
        subscription_tier: data.subscription_tier || 'free',
        subscription_end: data.subscription_end || null,
        loading: false,
      });
    } catch (error) {
      console.error('Error checking subscription:', error);
      setSubscriptionStatus(prev => ({ ...prev, loading: false }));
    }
  };

  const createSubscription = async () => {
    if (!user) return null;

    try {
      const { data, error } = await supabase.functions.invoke('create-paypal-subscription', {
        headers: {
          Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        },
      });

      if (error) throw error;

      return data.approvalUrl;
    } catch (error) {
      console.error('Error creating subscription:', error);
      toast.error('Failed to create subscription');
      return null;
    }
  };

  const cancelSubscription = async () => {
    if (!user) return false;

    try {
      const { data, error } = await supabase.functions.invoke('cancel-paypal-subscription', {
        headers: {
          Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        },
      });

      if (error) throw error;

      toast.success('Subscription cancelled successfully');
      await checkSubscription();
      return true;
    } catch (error) {
      console.error('Error cancelling subscription:', error);
      toast.error('Failed to cancel subscription');
      return false;
    }
  };

  useEffect(() => {
    if (user) {
      checkSubscription();
    }
  }, [user]);

  return {
    ...subscriptionStatus,
    checkSubscription,
    createSubscription,
    cancelSubscription,
  };
};