import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUserRoles } from '@/hooks/useUserRoles';
import { usePass, PASS_DAYS } from '@/hooks/usePass';
import { dbToPreferences, hasMeaningfulPreferences } from '@/lib/preferences';
import { toast } from 'sonner';

export const INCLUDED_VIEWINGS_PER_CYCLE = 3;
/** Free tier gets one coordinated viewing on the house, once per account. */
export const FREE_TRIAL_VIEWINGS = 1;
/** Matched listings needed before the free trial viewing unlocks. */
export const MATCHES_FOR_TRIAL = 3;
/** One $20 viewing pack: bought outright, stacks, and lapses after 30 days. */
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
  /** When the soonest-lapsing pack with credits left expires, if any. */
  packExpiresAt: string | null;
  /** True while the renter holds at least one live pack. */
  hasPack: boolean;
  /** True when the renter can book another viewing right now. */
  canBook: boolean;
  /** True when the allowance in play is the free tier's one-off trial. */
  isTrial: boolean;
  /** True when the free trial is still unspent - the booking is free. */
  trialAvailable: boolean;
  /** True when the free trial has been spent and upgrading is the way forward. */
  trialUsed: boolean;
  /** True when the trial is unspent but the intent gate hasn't been cleared yet. */
  trialLocked: boolean;
  /** What's still missing from the gate, so the UI can name it. */
  trialGate: {
    hasPreferences: boolean;
    matchCount: number;
    matchesNeeded: number;
  };
}

/**
 * Why a booking is blocked, in the words the renter needs.
 *
 * A locked trial and a spent one both read as "nothing left", but they want
 * opposite pitches: one asks the renter to finish setting up, the other asks
 * them to pay. Sending a locked renter to checkout would sell them a plan when
 * the thing they need is free and two clicks away.
 */
export const describeViewingBlock = (quota: ViewingQuota) => {
  if (quota.trialLocked) {
    const { hasPreferences, matchCount, matchesNeeded } = quota.trialGate;
    return {
      title: 'Your free viewing is almost unlocked',
      description: !hasPreferences
        ? 'Answer a few preference questions and match 3 listings, and we book your first viewing for you.'
        : `Match ${matchesNeeded - matchCount} more listing${matchesNeeded - matchCount === 1 ? '' : 's'} and we book your first viewing for you.`,
      showPaywall: false,
    };
  }
  return {
    title: quota.trialUsed
      ? "You've used your free viewing coordination"
      : 'Viewing bookings used up for this cycle',
    description: 'Skip the back-and-forth: pick times, and our team coordinates every viewing for you.',
    showPaywall: true,
  };
};

/**
 * Who can book a coordinated viewing, and how many are left.
 *
 * - Free tier: one trial booking per account, ever. It's the only way to feel
 *   what coordination does before paying, so it doesn't reset. It has to be
 *   earned first - preference quiz answered and 3 listings matched - because a
 *   coordinator's hour is too expensive to hand every signup on arrival. The
 *   same gate is enforced in SQL by free_viewing_trial_unlocked().
 * - Hausto Pass: $25 buys 3 bookings for 30 days, and $10 tops that up by 2.
 *   Passes stack across repeat purchases.
 * - Admins: a complimentary pass allowance, 3 bookings per rolling 30 days.
 *   It stays metered because each booking is a real coordinator hour.
 * - Legacy viewing packs ($20 for 10, retired): still spendable until they
 *   expire. None are live, but the ledger is still read so a stray one would
 *   be honoured rather than silently swallowed.
 *
 * Credits are only spent once the plan allowance above is exhausted - the same
 * order the DB trigger consumes them in.
 *
 * Cycle windows, mirroring base_viewing_allowance_remaining in SQL - the client
 * must not promise a booking the INSERT policy would refuse:
 * - Bought pass: its own period, expires_at minus PASS_DAYS, so a booking is
 *   charged to the pass that was live when it was made. Clamped to now() when
 *   passes have been extended past one period: cover stacks, the allowance does
 *   not.
 * - Admin, or no end date to work from: a rolling 30 days.
 */
export const useViewingQuota = () => {
  const { user } = useAuth();
  const { isAdmin, isLoading: rolesLoading } = useUserRoles();
  const { pass, isLoading: passLoading } = usePass();
  const queryClient = useQueryClient();

  const boughtPassExpiry = pass?.active && !pass.isComplimentary && pass.expiresAt
    ? pass.expiresAt
    : null;
  // An admin's complimentary pass spends on the same windowed allowance a
  // bought one does, so it takes the same branch below.
  const hasPlanAllowance = isAdmin || !!boughtPassExpiry;

  const { data: quota, isLoading: quotaLoading } = useQuery<ViewingQuota>({
    queryKey: ['viewing-quota', user?.id, hasPlanAllowance, boughtPassExpiry],
    queryFn: async () => {
      const now = new Date();

      /**
       * Listings booked against a windowed allowance. One coordination per
       * listing, so a three-listing request spends three - the same sum the
       * DB's base_viewing_allowance_remaining takes.
       */
      const countSince = async (since: Date) => {
        const { data } = await supabase
          .from('fast_track_requests')
          .select('property_ids')
          .eq('renter_id', user!.id)
          .neq('status', 'cancelled')
          .gte('created_at', since.toISOString());
        return (data ?? []).reduce((n, r) => n + Math.max(1, r.property_ids?.length ?? 1), 0);
      };

      // What the plan itself covers, before any pack credit is touched.
      let baseIncluded: number;
      let baseUsed: number;
      // Only the free tier's trial is gated, so these stay at their "cleared"
      // values for anyone on a paid allowance.
      let hasPreferences = true;
      let matchCount = MATCHES_FOR_TRIAL;
      let trialSpent = false;

      if (hasPlanAllowance) {
        baseIncluded = INCLUDED_VIEWINGS_PER_CYCLE;
        let cycleStart: Date;
        if (boughtPassExpiry) {
          // The pass's own period. Clamped to now() so an extended pass does
          // not reach back and count bookings from before its current cycle.
          cycleStart = new Date(
            new Date(boughtPassExpiry).getTime() - PASS_DAYS * 24 * 60 * 60 * 1000,
          );
          if (cycleStart > now) cycleStart = now;
        } else {
          cycleStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        }
        baseUsed = await countSince(cycleStart);
      } else {
        // The trial is tracked in its own ledger instead: cancelling or deleting
        // a request must not hand out a second free coordination.
        baseIncluded = FREE_TRIAL_VIEWINGS;
        const [{ data: trial }, { data: prefsRow }, { count }] = await Promise.all([
          supabase
            .from('viewing_trials')
            .select('used_at')
            .eq('renter_id', user!.id)
            .maybeSingle(),
          supabase
            .from('user_preferences')
            .select('user_id, styles, activities, must_haves, price_range_min, price_range_max, size, location, move_in_date')
            .eq('user_id', user!.id)
            .maybeSingle(),
          supabase
            .from('property_matches')
            .select('id', { count: 'exact', head: true })
            .eq('renter_id', user!.id),
        ]);

        trialSpent = !!trial;
        // Same test the SQL gate runs, kept in one place on the client.
        hasPreferences = hasMeaningfulPreferences(dbToPreferences(prefsRow ?? null));
        matchCount = count ?? 0;

        // A locked trial spends its allowance up front: the booking would be
        // refused by the INSERT policy anyway, so the quota must not promise it.
        const unlocked = hasPreferences && matchCount >= MATCHES_FOR_TRIAL;
        baseUsed = trialSpent || !unlocked ? 1 : 0;
      }

      // Only live packs count: a lapsed one's unspent credits are gone, so
      // showing them would promise bookings the DB would refuse.
      const { data: packs } = await supabase
        .from('viewing_addons')
        .select('credits, credits_used, expires_at')
        .eq('renter_id', user!.id)
        .gt('expires_at', now.toISOString())
        .order('expires_at', { ascending: true });

      // Pass and top-up credits live in their own ledger but spend the same
      // way, so they're folded in alongside the legacy packs.
      const { data: passRows } = await supabase
        .from('passes')
        .select('viewings_included, viewings_used, expires_at')
        .eq('renter_id', user!.id)
        .gt('expires_at', now.toISOString())
        .order('expires_at', { ascending: true });

      const livePacks = [
        ...(packs ?? []).map((p) => ({
          credits: p.credits,
          credits_used: p.credits_used,
          expires_at: p.expires_at,
        })),
        ...(passRows ?? []).map((p) => ({
          credits: p.viewings_included,
          credits_used: p.viewings_used,
          expires_at: p.expires_at,
        })),
      ].sort((a, b) => String(a.expires_at).localeCompare(String(b.expires_at)));

      const packTotal = livePacks.reduce((n, p) => n + p.credits, 0);
      const packSpent = livePacks.reduce((n, p) => n + p.credits_used, 0);
      const packRemaining = Math.max(0, packTotal - packSpent);
      // The soonest deadline is the one worth warning about - credits are spent
      // from that pack first.
      const packExpiresAt = livePacks.find((p) => p.credits_used < p.credits)?.expires_at ?? null;

      const baseRemaining = Math.max(0, baseIncluded - baseUsed);
      const included = baseIncluded + packTotal;
      const remaining = baseRemaining + packRemaining;
      const used = Math.max(0, included - remaining);
      const hasPack = packTotal > 0;
      // The trial is what's on offer only while neither paid route applies.
      const isTrial = !hasPlanAllowance && !hasPack;
      return {
        included,
        used,
        remaining,
        baseRemaining,
        packRemaining,
        packExpiresAt,
        hasPack,
        canBook: remaining > 0,
        isTrial,
        trialAvailable: isTrial && remaining > 0,
        // "Used" and "locked" both read as zero remaining but want opposite
        // pitches - one upgrades, the other finishes the quiz - so the ledger
        // decides which, not the count.
        trialUsed: isTrial && remaining === 0 && trialSpent,
        trialLocked: isTrial && remaining === 0 && !trialSpent,
        trialGate: {
          hasPreferences,
          matchCount,
          matchesNeeded: MATCHES_FOR_TRIAL,
        },
      };
    },
    // Waiting on the pass: reading a pass holder as free-tier for a moment
    // would show them one viewing and the trial gate instead of their three.
    enabled: !!user?.id && !rolesLoading && !passLoading,
  });

  const refetchQuota = () =>
    queryClient.invalidateQueries({ queryKey: ['viewing-quota'] });

  // No purchase starter here any more: the $20 pack is retired, and the Pass
  // and top-up are bought through usePass(). Credits from packs already sold
  // stay spendable above until they lapse.

  return {
    quota,
    isLoading: quotaLoading || rolesLoading || passLoading,
    refetchQuota,
  };
};
