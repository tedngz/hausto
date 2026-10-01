import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePass } from '@/hooks/usePass';
import { toast } from 'sonner';

interface UsageLimits {
  propertiesMatched: number;
  quizRetakes: number;
  aiSearches: number;
}

// The daily ceiling is the free tier's. Anyone covered - a live Hausto Pass or
// an admin's complimentary pass - searches without one.
//
// AI requests are the only metered thing left. The per-listing view budget went
// with the swipe deck; the weekly match cap and the quiz retake cap went with
// the plan rework - the curated list is what Hausto is for, so walling it off
// was metering the promise. Matches and retakes are still counted into
// daily_usage as telemetry, there is just no ceiling on either any more.
const FREE_TIER_LIMITS = {
  dailyAiRequests: 10,
};

export const useUsageTracking = () => {
  const { user, loading: authLoading } = useAuth();
  const { pass } = usePass();
  const [todayUsage, setTodayUsage] = useState<UsageLimits>({
    propertiesMatched: 0,
    quizRetakes: 0,
    aiSearches: 0,
  });
  const [weeklyMatches, setWeeklyMatches] = useState(0);
  const [loading, setLoading] = useState(true);

  // Fallback to database if Redis is unavailable
  const fetchUsageFromDatabase = useCallback(async () => {
    if (!user?.id) return;

    try {
      const today = new Date().toISOString().split('T')[0];
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
      const weekAgo = sevenDaysAgo.toISOString().split('T')[0];

      const { data: todayData } = await supabase
        .from('daily_usage')
        .select('*')
        .eq('user_id', user.id)
        .eq('usage_date', today)
        .maybeSingle();

      if (todayData) {
        setTodayUsage({
          propertiesMatched: todayData.properties_matched,
          quizRetakes: todayData.quiz_retakes,
          aiSearches: todayData.ai_requests || 0,
        });
      }

      const { data: weeklyData } = await supabase
        .from('daily_usage')
        .select('properties_matched')
        .eq('user_id', user.id)
        .gte('usage_date', weekAgo)
        .lte('usage_date', today);

      if (weeklyData) {
        const total = weeklyData.reduce((sum, day) => sum + day.properties_matched, 0);
        setWeeklyMatches(total);
      }
    } catch (error) {
      console.error('[Usage Tracking] Database fallback error:', error);
    }
  }, [user?.id]);

  const fetchUsage = useCallback(async () => {
    if (!user?.id) {
      console.log('[Usage Tracking] No user available');
      return;
    }

    console.log('[Usage Tracking] Fetching usage via Redis for user:', user.id);

    try {
      // Residue from the retired swipe deck, which parked the day's seen
      // listings here so a second look did not count twice. Nothing writes
      // them any more, so clear what a returning renter still has.
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith('viewedProperties_')) localStorage.removeItem(key);
      });

      // Get current session to ensure auth headers are included
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        console.error('[Usage Tracking] No active session');
        setLoading(false);
        return;
      }

      // Get usage from Redis via edge function
      const { data: usageData, error: usageError } = await supabase.functions.invoke(
        'usage-tracking-redis',
        { body: { action: 'get' } }
      );

      if (usageError) {
        console.error('[Usage Tracking] Redis error, falling back to database:', usageError);
        await fetchUsageFromDatabase();
        return;
      }

      console.log('[Usage Tracking] Retrieved usage from Redis:', usageData);

      setTodayUsage({
        propertiesMatched: usageData.propertiesMatched || 0,
        quizRetakes: usageData.quizRetakes || 0,
        aiSearches: usageData.aiSearches || 0,
      });

      setWeeklyMatches(usageData.weeklyMatches || 0);
    } catch (error) {
      console.error('[Usage Tracking] Error in fetchUsage:', error);
    } finally {
      setLoading(false);
    }
  }, [user?.id, fetchUsageFromDatabase]);

  useEffect(() => {
    // Don't fetch until auth is initialized
    if (authLoading) {
      console.log('[Usage Tracking] Waiting for auth to initialize');
      return;
    }
    fetchUsage();
  }, [fetchUsage, authLoading]);

  // Re-registered when fetchUsage changes, which is when the user does. Bound
  // once, the handler kept the fetchUsage from mount - and a hook that mounted
  // before auth resolved kept one with no user, so its refetches did nothing.
  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent;
      const detail = custom.detail || {};
      if (detail.todayUsage) {
        setTodayUsage(detail.todayUsage);
      }
      if (typeof detail.weeklyMatches === 'number') {
        setWeeklyMatches(detail.weeklyMatches);
      }
      if (!detail.todayUsage) {
        fetchUsage();
      }
    };
    window.addEventListener('usage:updated', handler as EventListener);
    return () => window.removeEventListener('usage:updated', handler as EventListener);
  }, [fetchUsage]);

  const updateUsage = async (type: 'match' | 'quiz' | 'ai-search') => {
    if (!user?.id) {
      console.log('[Usage Tracking] Cannot update usage - no user');
      return;
    }

    try {
      console.log(`[Usage Tracking] Incrementing usage: ${type}`);

      // Ensure we have an active session
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        console.error('[Usage Tracking] No active session for usage increment');
        return;
      }

      const { data, error } = await supabase.functions.invoke(
        'usage-tracking-redis',
        {
          body: {
            action: 'increment',
            type,
          },
        }
      );

      if (error) {
        console.error('[Usage Tracking] Error incrementing usage:', error);
        toast.error('Failed to update usage');
        return;
      }

      console.log('[Usage Tracking] Successfully incremented:', data);

      // Update local state optimistically
      setTodayUsage(prev => {
        const updated = { ...prev };
        switch (type) {
          case 'match':
            updated.propertiesMatched += 1;
            break;
          case 'quiz':
            updated.quizRetakes += 1;
            break;
          case 'ai-search':
            updated.aiSearches += 1;
            break;
        }
        return updated;
      });

      if (type === 'match') {
        setWeeklyMatches(prev => prev + 1);
      }

      window.dispatchEvent(new CustomEvent('usage:updated'));

    } catch (error) {
      console.error('[Usage Tracking] Error in updateUsage:', error);
      toast.error('Failed to update usage');
    }
  };

  // A live pass - bought or complimentary - is the whole of cover now.
  const hasUnlimitedAi = !!pass?.active;

  const canPerformAction = useCallback((type: 'match' | 'quiz' | 'ai-search'): boolean => {
    // Don't block actions while the usage read is still in flight
    if (loading) {
      console.log('[Usage Tracking] Still loading usage - allowing action');
      return true;
    }

    console.log(`[Usage Tracking] Checking if can perform ${type}:`, {
      hasPass: hasUnlimitedAi,
      weeklyMatches,
      todayAiSearches: todayUsage.aiSearches
    });

    if (hasUnlimitedAi) {
      console.log('[Usage Tracking] Covered by a pass - unlimited access');
      return true;
    }

    switch (type) {
      // Matching and retaking the quiz are unlimited on every tier.
      case 'match':
      case 'quiz':
        return true;
      case 'ai-search': {
        const canAiSearch = todayUsage.aiSearches < FREE_TIER_LIMITS.dailyAiRequests;
        console.log(`[Usage Tracking] Can AI search: ${canAiSearch} (${todayUsage.aiSearches}/${FREE_TIER_LIMITS.dailyAiRequests})`);
        return canAiSearch;
      }
      default:
        return false;
    }
  }, [hasUnlimitedAi, todayUsage, weeklyMatches, loading]);

  const getRemainingActions = (type: 'match' | 'quiz' | 'ai-search'): number => {
    if (hasUnlimitedAi) {
      return Infinity;
    }

    switch (type) {
      case 'match':
      case 'quiz':
        return Infinity;
      case 'ai-search':
        return Math.max(0, FREE_TIER_LIMITS.dailyAiRequests - todayUsage.aiSearches);
      default:
        return 0;
    }
  };

  const refetchUsage = useCallback(async () => {
    console.log('[Usage Tracking] Manually refetching usage data');
    await fetchUsage();
  }, [fetchUsage]);

  return {
    todayUsage,
    weeklyMatches,
    hasUnlimitedAi,
    loading,
    limits: FREE_TIER_LIMITS,
    updateUsage,
    canPerformAction,
    getRemainingActions,
    refetchUsage,
    FREE_TIER_LIMITS,
  };
};
