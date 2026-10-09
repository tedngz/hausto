import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUserRoles } from '@/hooks/useUserRoles';
import { toast } from 'sonner';
import { PASS_DAYS, PASS_PRICE_USD } from '../../supabase/functions/_shared/viewing/lock-in.ts';

// One price, read from the module the lock-in uses, so the page, the modal
// and the WhatsApp plan cannot quote different figures.
export { PASS_DAYS, PASS_PRICE_USD };

export interface PassStatus {
  /** True while the renter is covered by a live pass. */
  active: boolean;
  /** When cover runs out. Null when there is none. */
  expiresAt: string | null;
  /** Whole days left, rounded up. 0 when there's no cover. */
  daysLeft: number;
  /** True when cover comes with the admin seat rather than a purchase. */
  isComplimentary: boolean;
}

/**
 * Whether the renter holds a live Hausto Pass, and for how much longer.
 *
 * The Pass is bought outright for 30 days - a rental search is a burst - and
 * simply bought again if the search runs long. Nothing recurs. Since
 * 2026-10-07 it is what has us arrange viewings - past one free place per
 * WhatsApp number - and ask about buildings, and it covers every viewing
 * agents confirm in those 30 days, plus unlimited AI and Deep scan (SPEC §9).
 * The $10 top-up for two more viewings is retired.
 *
 * Admins hold a pass by default so they can walk the paid product without
 * buying one every 30 days. It never expires and is mirrored in SQL by
 * has_complimentary_pass().
 */
export const usePass = () => {
  const { user } = useAuth();
  const { isAdmin, isLoading: rolesLoading } = useUserRoles();
  const queryClient = useQueryClient();

  const { data: pass, isLoading } = useQuery<PassStatus>({
    queryKey: ['pass', user?.id, isAdmin],
    queryFn: async () => {
      if (isAdmin) {
        return {
          active: true,
          expiresAt: null,
          daysLeft: 0,
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

      // Passes extend each other, so cover runs to the furthest one.
      const expiresAt = data?.[0]?.expires_at ?? null;

      const daysLeft = expiresAt
        ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000))
        : 0;

      return {
        active: !!expiresAt,
        expiresAt,
        daysLeft,
        isComplimentary: false,
      };
    },
    // Waiting on roles: reading an admin as uncovered for a moment would flash
    // the paywall at them on every load.
    enabled: !!user?.id && !rolesLoading,
  });

  const refetchPass = () => queryClient.invalidateQueries({ queryKey: ['pass'] });

  /**
   * Starts a Pass purchase and hands off to Polar's hosted checkout. With a
   * request ref, the Pass is bought to lock that plan in: the plan is held
   * while the checkout is open, and locked in when the payment is recorded.
   * `digestOptIn` is the box on our page, never assumed from buying.
   */
  const purchasePass = async (requestRef?: string, opts: { digestOptIn?: boolean } = {}) => {
    try {
      const { data, error } = await supabase.functions.invoke('create-pass-order', {
        headers: {
          Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        },
        body: {
          kind: 'pass',
          ...(requestRef ? { requestRef } : {}),
          ...(opts.digestOptIn ? { digestOptIn: true } : {}),
        },
      });
      // A refusal (a plan past its deadline, say) has its reason in the body.
      let reason = data?.error as string | undefined;
      if (error && !reason) {
        const ctx = (error as { context?: Response }).context;
        const body = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null;
        reason = body?.error;
      }
      if (reason || error) throw new Error(reason || error?.message);
      if (data?.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (err) {
      console.error('Error starting pass purchase:', err);
      const message = err instanceof Error ? err.message : '';
      toast.error(
        /plan|Pass|account/.test(message) ? message : 'Could not start the purchase. Please try again.',
      );
    }
  };

  return {
    pass,
    isLoading: isLoading || rolesLoading,
    refetchPass,
    purchasePass,
  };
};
