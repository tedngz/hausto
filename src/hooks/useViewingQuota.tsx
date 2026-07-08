import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { toast } from 'sonner';

export const INCLUDED_VIEWINGS_PER_CYCLE = 3;

export interface ViewingQuota {
  /** Bookings included in the current subscription cycle. */
  included: number;
  /** Bookings used in the current cycle (cancelled requests don't count). */
  used: number;
  /** Remaining included bookings (0 when the unlimited add-on covers it). */
  remaining: number;
  /** True while a purchased unlimited-month add-on is active. */
  unlimited: boolean;
  /** Expiry of the active add-on, if any. */
  addonExpiresAt: string | null;
  /** True when the renter can book another viewing right now. */
  canBook: boolean;
}

/**
 * Premium renters get 3 Fast-Track viewing bookings per subscription cycle.
 * A $20 add-on (viewing_addons row) lifts the cap for 30 days.
 *
 * Cycle window: subscription_end minus one month (the plan bills monthly).
 * Fallback when subscription_end is unavailable: a rolling 30-day window.
 */
export const useViewingQuota = () => {
  const { user } = useAuth();
  const { subscription_end } = useSubscription();
  const queryClient = useQueryClient();

  const { data: quota, isLoading } = useQuery<ViewingQuota>({
    queryKey: ['viewing-quota', user?.id, subscription_end],
    queryFn: async () => {
      const now = new Date();

      let cycleStart: Date;
      if (subscription_end) {
        cycleStart = new Date(subscription_end);
        cycleStart.setMonth(cycleStart.getMonth() - 1);
        // Guard against stale subscription_end producing a future cycle start.
        if (cycleStart > now) cycleStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      } else {
        cycleStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      const [{ count }, { data: addon }] = await Promise.all([
        supabase
          .from('fast_track_requests')
          .select('id', { count: 'exact', head: true })
          .eq('renter_id', user!.id)
          .neq('status', 'cancelled')
          .gte('created_at', cycleStart.toISOString()),
        supabase
          .from('viewing_addons')
          .select('expires_at')
          .eq('renter_id', user!.id)
          .gt('expires_at', now.toISOString())
          .order('expires_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const used = count ?? 0;
      const unlimited = !!addon;
      const remaining = Math.max(0, INCLUDED_VIEWINGS_PER_CYCLE - used);
      return {
        included: INCLUDED_VIEWINGS_PER_CYCLE,
        used,
        remaining,
        unlimited,
        addonExpiresAt: addon?.expires_at ?? null,
        canBook: unlimited || remaining > 0,
      };
    },
    enabled: !!user?.id,
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

  return { quota, isLoading, refetchQuota, purchaseUnlimitedMonth };
};
