import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { toast } from 'sonner';

export const INCLUDED_VIEWINGS_PER_CYCLE = 3;
/** Free tier gets one coordinated viewing on the house, once per account. */
export const FREE_TRIAL_VIEWINGS = 1;
/** One $20 viewing pack. Packs are bought outright and stack. */
export const VIEWINGS_PER_PACK = 10;

export interface ViewingQuota {
  /** Everything the account has to spend: plan allowance plus every pack bought. */
  included: number;
  /** Bookings spent against that total (cancelled requests don't count). */
  used: number;
  /** Bookings left in total. */
  remaining: number;
  /** Bookings the plan itself still covers this cycle (or the lifetime trial). */
  baseRemaining: number;
  /** Unspent pack credits, across every pack bought. */
  packRemaining: number;
  /** True once the renter has bought at least one pack. */
  hasPack: boolean;
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
 * - Viewing packs: $20 buys 10 bookings outright. They don't expire, they stack
 *   across repeat purchases, and they're only spent once the plan allowance
 *   above is exhausted - the same order the DB trigger consumes them in.
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

      /** Requests that count against a windowed allowance. */
      const countSince = async (since: Date) => {
        const { count } = await supabase
          .from('fast_track_requests')
          .select('id', { count: 'exact', head: true })
          .eq('renter_id', user!.id)
          .neq('status', 'cancelled')
          .gte('created_at', since.toISOString());
        return count ?? 0;
      };

      // What the plan itself covers, before any pack credit is touched.
      let baseIncluded: number;
      let baseUsed: number;

      if (isPremium) {
        baseIncluded = INCLUDED_VIEWINGS_PER_CYCLE;
        let cycleStart: Date;
        if (subscription_end) {
          cycleStart = new Date(subscription_end);
          cycleStart.setMonth(cycleStart.getMonth() - 1);
          // Guard against stale subscription_end producing a future cycle start.
          if (cycleStart > now) cycleStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        } else {
          cycleStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        }
        baseUsed = await countSince(cycleStart);
      } else {
        // The trial is tracked in its own ledger instead: cancelling or deleting
        // a request must not hand out a second free coordination.
        baseIncluded = FREE_TRIAL_VIEWINGS;
        const { data: trial } = await supabase
          .from('viewing_trials')
          .select('used_at')
          .eq('renter_id', user!.id)
          .maybeSingle();
        baseUsed = trial ? 1 : 0;
      }

      // Packs are bought outright, so every row the renter owns counts - spent
      // ones included, which is what makes the totals below add up.
      const { data: packs } = await supabase
        .from('viewing_addons')
        .select('credits, credits_used')
        .eq('renter_id', user!.id);

      const packTotal = (packs ?? []).reduce((n, p) => n + p.credits, 0);
      const packSpent = (packs ?? []).reduce((n, p) => n + p.credits_used, 0);
      const packRemaining = Math.max(0, packTotal - packSpent);

      const baseRemaining = Math.max(0, baseIncluded - baseUsed);
      const included = baseIncluded + packTotal;
      const remaining = baseRemaining + packRemaining;
      const used = Math.max(0, included - remaining);
      const hasPack = packTotal > 0;
      // The trial is what's on offer only while neither paid route applies.
      const isTrial = !isPremium && !hasPack;
      return {
        included,
        used,
        remaining,
        baseRemaining,
        packRemaining,
        hasPack,
        canBook: remaining > 0,
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

  /** Starts the $20 viewing-pack purchase; redirects to PayPal on success. */
  const purchaseViewingPack = async () => {
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
    purchaseViewingPack,
  };
};
