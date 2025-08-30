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
      
      // First, try to get data from PayPal
      const { data, error } = await supabase.functions.invoke('check-paypal-subscription', {
        headers: {
          Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        },
      });

      console.log('Subscription function response:', data);

      // If PayPal auth failed but we have a subscription error, fall back to database
      if (error || data?.error) {
        console.log('PayPal check failed, falling back to database:', data?.error || error);
        
        // Fallback: Check the database directly for subscription status using secure function
        const { data: dbData, error: dbError } = await supabase
          .rpc('get_user_subscription_status');

        if (!dbError && dbData && dbData.length > 0) {
          console.log('Database subscription data:', dbData[0]);
          setSubscriptionStatus({
            subscribed: dbData[0].subscribed === true,
            subscription_tier: dbData[0].subscription_tier || 'free',
            subscription_end: dbData[0].subscription_end || null,
            loading: false,
          });
          return;
        }
      }

      // Use PayPal data if successful
      setSubscriptionStatus({
        subscribed: data?.subscribed === true,
        subscription_tier: data?.subscription_tier || 'free',
        subscription_end: data?.subscription_end || null,
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