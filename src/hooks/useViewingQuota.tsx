import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUserRoles } from '@/hooks/useUserRoles';
import { usePass } from '@/hooks/usePass';
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
 * Each entitlement is counted once, and only once, which is the rule this got
 * wrong: a bought pass draws purely on the passes ledger, never on a windowed
 * allowance as well. Granting both handed out six coordinations for a
 * three-viewing product, because the two are independent mechanisms that each
 * believed they owned the same three.
 *
 * The windowed allowance therefore survives only where there is no ledger row
 * to spend from, mirroring base_viewing_allowance_remaining in SQL - the client
 * must not promise a booking the INSERT policy would refuse:
 * - Complimentary (admin) cover: a rolling 30 days. It writes no passes row.
 * - Free tier: the one-off trial, tracked in viewing_trials.
 */
export const useViewingQuota = () => {
  const { user } = useAuth();
  const { isAdmin, isLoading: rolesLoading } = useUserRoles();
  const { pass, isLoading: passLoading } = usePass();
  const queryClient = useQueryClient();

  const boughtPassExpiry = pass?.active && !pass.isComplimentary && pass.expiresAt
    ? pass.expiresAt
    : null;
  // Complimentary cover is the only thing that still draws on a windowed
  // allowance: it writes no passes row, so there is no ledger to spend from.
  // A bought pass carries its viewings in that ledger instead, and counting a
  // window for it too was handing out - and the DB was allowing - double.
  const hasComplimentaryAllowance = isAdmin;
  // Still "on a paid footing" for the trial copy below, whichever route.
  const hasPlanAllowance = hasComplimentaryAllowance || !!boughtPassExpiry;

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

      if (hasComplimentaryAllowance) {
        baseIncluded = INCLUDED_VIEWINGS_PER_CYCLE;
        baseUsed = await countSince(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
      } else if (boughtPassExpiry) {
        // Nothing here: every viewing the pass bought is a row in the passes
        // ledger, folded in with the packs below. Mirrors the SQL, which
        // returns 0 from base_viewing_allowance_remaining for the same reason.
        baseIncluded = 0;
        baseUsed = 0;
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
