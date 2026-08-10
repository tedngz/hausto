import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { toast } from 'sonner';

export const INCLUDED_VIEWINGS_PER_CYCLE = 3;
/** Free tier gets one coordinated viewing on the house, once per account. */
export const FREE_TRIAL_VIEWINGS = 1;

export interface ViewingQuota {
  /** Bookings included in the current allowance (cycle for premium, lifetime for the trial). */
  included: number;
  /** Bookings used against that allowance (cancelled requests don't count). */
  used: number;
  /** Remaining included bookings (0 when the unlimited add-on covers it). */
  remaining: number;
  /** True while a purchased unlimited-month add-on is active. */
  unlimited: boolean;
  /** Expiry of the active add-on, if any. */
  addonExpiresAt: string | null;
  /** True when the renter can book another viewing right now. */
  canBook: boolean;
  /** True when the allowance in play is the free tier's one-off trial. */
  isTrial: boolean;
  /** True when the free trial is still unspent - the booking is free. */
  trialAvailable: boolean;
  /** True when the free trial has been spent and upgrading is the way forward. */
  trialUsed: boolean;
}

/**
 * Who can book a coordinated viewing, and how many are left.
 *
 * - Free tier: one trial booking per account, ever. It's the only way to feel
 *   what coordination does before paying, so it doesn't reset.
 * - Premium: 3 bookings per subscription cycle.
 * - The $20 add-on (viewing_addons row) lifts the cap for 30 days, either way.
 *
 * Premium cycle window: subscription_end minus one month (the plan bills
 * monthly). Fallback when subscription_end is unavailable: a rolling 30 days.
 */
export const useViewingQuota = () => {
  const { user } = useAuth();
  const { subscribed, subscription_tier, subscription_end, loading: subscriptionLoading } = useSubscription();
  const queryClient = useQueryClient();

  const isPremium = subscribed && subscription_tier === 'premium';

  const { data: quota, isLoading: quotaLoading } = useQuery<ViewingQuota>({
    queryKey: ['viewing-quota', user?.id, isPremium, subscription_end],
    queryFn: async () => {
      const now = new Date();

      const [used, addon] = await Promise.all([
        (async () => {
          // Premium counts requests inside the billing cycle. The trial is
          // tracked in its own ledger instead: cancelling or deleting a request
          // must not hand out a second free coordination.
          if (!isPremium) {
            const { data: trial } = await supabase
              .from('viewing_trials')
              .select('used_at')
              .eq('renter_id', user!.id)
              .maybeSingle();
            return trial ? 1 : 0;
          }

          let cycleStart: Date;
          if (subscription_end) {
            cycleStart = new Date(subscription_end);
            cycleStart.setMonth(cycleStart.getMonth() - 1);
            // Guard against stale subscription_end producing a future cycle start.
            if (cycleStart > now) cycleStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          } else {
            cycleStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          }

          const { count } = await supabase
            .from('fast_track_requests')
            .select('id', { count: 'exact', head: true })
            .eq('renter_id', user!.id)
            .neq('status', 'cancelled')
            .gte('created_at', cycleStart.toISOString());
          return count ?? 0;
        })(),
        (async () => {
          const { data } = await supabase
            .from('viewing_addons')
            .select('expires_at')
            .eq('renter_id', user!.id)
            .gt('expires_at', now.toISOString())
            .order('expires_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          return data;
        })(),
      ]);

      const unlimited = !!addon;
      const included = isPremium ? INCLUDED_VIEWINGS_PER_CYCLE : FREE_TRIAL_VIEWINGS;
      const remaining = Math.max(0, included - used);
      // The trial is what's on offer only while neither paid route applies.
      const isTrial = !isPremium && !unlimited;
      return {
        included,
        used,
        remaining,
        unlimited,
        addonExpiresAt: addon?.expires_at ?? null,
        canBook: unlimited || remaining > 0,
        isTrial,
        trialAvailable: isTrial && remaining > 0,
        trialUsed: isTrial && remaining === 0,
      };
    },
    // Waiting for the tier keeps a premium renter from being read as free tier
    // (and told their trial is spent) during the subscription check.
    enabled: !!user?.id && !subscriptionLoading,
  });

  const refetchQuota = () =>
    queryClient.invalidateQueries({ queryKey: ['viewing-quota'] });

  /** Starts the $20 unlimited-month purchase; redirects to PayPal on success. */
  const purchaseUnlimitedMonth = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('create-viewing-addon-order', {
        headers: {
          Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      if (data?.approvalUrl) {
        window.location.href = data.approvalUrl;
      } else {
        throw new Error('No approval URL returned');
      }
    } catch (err) {
      console.error('Error starting add-on purchase:', err);
      toast.error('Could not start the purchase. Please try again.');
    }
  };

  return {
    quota,
    isLoading: quotaLoading || subscriptionLoading,
    refetchQuota,
    purchaseUnlimitedMonth,
  };
};
