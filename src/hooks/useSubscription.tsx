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
    paypal_subscription_id: null as string | null,
    is_suspended: false,
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
        
        // Fallback: Check the database directly for subscription status
        const { data: dbData, error: dbError } = await supabase
          .from('subscribers')
          .select('subscribed, subscription_tier, subscription_end, paypal_subscription_id')
          .eq('user_id', user.id)
          .single();

        if (!dbError && dbData) {
          console.log('Database subscription data:', dbData);
          setSubscriptionStatus({
            subscribed: dbData.subscribed === true,
            subscription_tier: dbData.subscription_tier || 'free',
            subscription_end: dbData.subscription_end || null,
            paypal_subscription_id: dbData.paypal_subscription_id || null,
            is_suspended: false,
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
        paypal_subscription_id: data?.paypal_subscription_id || null,
        is_suspended: data?.is_suspended === true,
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

  const reactivateSubscription = async () => {
    if (!user) return false;

    try {
      const { data, error } = await supabase.functions.invoke('reactivate-paypal-subscription', {
        headers: {
          Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success('Subscription reactivated successfully!');
      await checkSubscription();
      return true;
    } catch (error) {
      console.error('Error reactivating subscription:', error);
      toast.error('Failed to reactivate subscription. Please try creating a new one.');
      return false;
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
    reactivateSubscription,
  };
};