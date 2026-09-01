import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { useUserRoles } from '@/hooks/useUserRoles';
import { toast } from 'sonner';

export const PASS_PRICE_USD = 25;
export const PASS_DAYS = 30;
export const PASS_VIEWINGS = 3;
export const TOPUP_PRICE_USD = 10;
export const TOPUP_VIEWINGS = 2;

export interface PassStatus {
  /** True while the renter is covered - a live pass, or a legacy subscription. */
  active: boolean;
  /** When cover runs out. Null when there is none. */
  expiresAt: string | null;
  /** Whole days left, rounded up. 0 when there's no cover. */
  daysLeft: number;
  /** True when cover comes from the retired $10/mo Premium plan, not a pass. */
  isLegacySubscription: boolean;
  /** True when cover comes with the admin seat rather than a purchase. */
  isComplimentary: boolean;
}

/**
 * Whether the renter holds a live Hausto Pass, and for how much longer.
 *
 * The Pass replaced the monthly subscription: a rental search is a burst, so it
 * is bought outright for 30 days and simply bought again if the search runs
 * long. Nothing recurs, so there is no cancel, no reactivate and no dunning.
 *
 * Admins hold a pass by default so they can walk the paid product without
 * buying one every 30 days. It never expires and is mirrored in SQL by
 * has_complimentary_pass().
 *
 * Renters still inside a $10/mo Premium cycle are honoured here as active until
 * their cycle ends - they paid for cover, and which product it came from isn't
 * their problem. Nothing new is sold into that plan; once the last cycle
 * lapses, the subscription read can go with it.
 */
export const usePass = () => {
  const { user } = useAuth();
  const { isAdmin, isLoading: rolesLoading } = useUserRoles();
  const {
    subscribed,
    subscription_tier,
    subscription_end,
    loading: subscriptionLoading,
  } = useSubscription();
  const queryClient = useQueryClient();

  const legacyActive = subscribed && subscription_tier === 'premium';

  const { data: pass, isLoading } = useQuery<PassStatus>({
    queryKey: ['pass', user?.id, isAdmin, legacyActive, subscription_end],
    queryFn: async () => {
      if (isAdmin) {
        return {
          active: true,
          expiresAt: null,
          daysLeft: 0,
          isLegacySubscription: false,
          isComplimentary: true,
        };
      }

      const { data } = await supabase
        .from('passes')
        .select('expires_at')
        .eq('renter_id', user!.id)
        .eq('kind', 'pass')
        .gt('expires_at', new Date().toISOString())
        .order('expires_at', { ascending: false })
        .limit(1);

      // Passes extend each other, so cover runs to the furthest one - and a legacy cycle
      // counts too if it happens to outlast them.
      const passExpiry = data?.[0]?.expires_at ?? null;
      const legacyExpiry = legacyActive ? subscription_end : null;
      const candidates = [passExpiry, legacyExpiry].filter(Boolean) as string[];
      const expiresAt = candidates.length
        ? candidates.reduce((a, b) => (new Date(a) > new Date(b) ? a : b))
        : null;

      const daysLeft = expiresAt
        ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000))
        : 0;

      return {
        active: !!expiresAt,
        expiresAt,
        daysLeft,
        isLegacySubscription: !passExpiry && !!legacyExpiry,
        isComplimentary: false,
      };
    },
    // Waiting for the legacy check keeps a paid-up subscriber from being read
    // as uncovered during the subscription lookup.
    // Waiting on roles too: reading an admin as uncovered for a moment would
    // flash the paywall at them on every load.
    enabled: !!user?.id && !subscriptionLoading && !rolesLoading,
  });

  const refetchPass = () => queryClient.invalidateQueries({ queryKey: ['pass'] });

  /** Starts a purchase and hands off to PayPal. */
  const buy = async (kind: 'pass' | 'topup') => {
    try {
      const { data, error } = await supabase.functions.invoke('create-pass-order', {
        headers: {
          Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        },
        body: { kind },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      if (data?.approvalUrl) {
        window.location.href = data.approvalUrl;
      } else {
        throw new Error('No approval URL returned');
      }
    } catch (err) {
      console.error(`Error starting ${kind} purchase:`, err);
      toast.error(
        err instanceof Error && err.message.includes('live Hausto Pass')
          ? err.message
          : 'Could not start the purchase. Please try again.',
      );
    }
  };

  return {
    pass,
    isLoading: isLoading || subscriptionLoading || rolesLoading,
    refetchPass,
    purchasePass: () => buy('pass'),
    purchaseTopUp: () => buy('topup'),
  };
};
