import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

interface UsageLimits {
  propertiesViewed: number;
  propertiesMatched: number;
  quizRetakes: number;
  aiSearches: number;
}

interface SubscriptionStatus {
  subscribed: boolean;
  subscription_tier: string;
  subscription_end?: string;
}

const FREE_TIER_LIMITS = {
  dailyViews: 10,
  weeklyMatches: 20,
  dailyAiRequests: 10,
};

export const useUsageTracking = () => {
  const { user, loading: authLoading } = useAuth();
  const [todayUsage, setTodayUsage] = useState<UsageLimits>({
    propertiesViewed: 0,
    propertiesMatched: 0,
    quizRetakes: 0,
    aiSearches: 0,
  });
  const [weeklyMatches, setWeeklyMatches] = useState(0);
  const [viewedPropertiesToday, setViewedPropertiesToday] = useState<Set<string>>(() => {
    const today = new Date().toISOString().split('T')[0];
    const stored = localStorage.getItem(`viewedProperties_${today}`);
    return stored ? new Set(JSON.parse(stored)) : new Set();
  });
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus>({
    subscribed: false,
    subscription_tier: 'free',
  });
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
          propertiesViewed: todayData.properties_viewed,
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
      const today = new Date().toISOString().split('T')[0];

      // Load viewed properties from localStorage
      const stored = localStorage.getItem(`viewedProperties_${today}`);
      const viewedSet = stored ? new Set<string>(JSON.parse(stored) as string[]) : new Set<string>();
      setViewedPropertiesToday(viewedSet);

      // Clean up old localStorage entries
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('viewedProperties_') && key !== `viewedProperties_${today}`) {
          localStorage.removeItem(key);
        }
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
        propertiesViewed: usageData.propertiesViewed || 0,
        propertiesMatched: usageData.propertiesMatched || 0,
        quizRetakes: usageData.quizRetakes || 0,
        aiSearches: usageData.aiSearches || 0,
      });

      setWeeklyMatches(usageData.weeklyMatches || 0);

      // Get subscription status
      const { data: subData, error: subError } = await supabase
        .from('subscribers')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (subError) {
        console.error('[Usage Tracking] Error fetching subscription:', subError);
      }

      if (subData) {
        setSubscriptionStatus({
          subscribed: subData.subscribed,
          subscription_tier: subData.subscription_tier,
          subscription_end: subData.subscription_end,
        });
      } else {
        setSubscriptionStatus({
          subscribed: false,
          subscription_tier: 'free',
        });
      }
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
  }, []);

  const updatePropertyView = useCallback(async (propertyId: string) => {
    if (!user?.id || !propertyId) {
      console.error('[Usage Tracking] No user ID or property ID');
      return false;
    }

    if (viewedPropertiesToday.has(propertyId)) {
      console.log('[Usage Tracking] Property already viewed today:', propertyId);
      return true;
    }

    // Check if user can view more properties BEFORE incrementing
    const canView = subscriptionStatus.subscribed && subscriptionStatus.subscription_tier === 'premium' 
      ? true 
      : todayUsage.propertiesViewed < FREE_TIER_LIMITS.dailyViews;

    if (!canView) {
      console.log('[Usage Tracking] View limit reached, cannot track view:', propertyId);
      return false;
    }

    try {
      console.log('[Usage Tracking] Tracking unique property view via Redis');

      // Ensure we have an active session
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        console.error('[Usage Tracking] No active session for view tracking');
        return false;
      }

      const { data, error } = await supabase.functions.invoke(
        'usage-tracking-redis',
        {
          body: {
            action: 'increment',
            type: 'view',
            propertyId, // Pass propertyId to track unique views
          },
        }
      );

      if (error) {
        console.error('[Usage Tracking] Error incrementing view:', error);
        return false;
      }

      const serverCount = typeof data?.count === 'number' ? data.count : undefined;

      // If server indicates limit reached, sync count and block further views
      if (!subscriptionStatus.subscribed || subscriptionStatus.subscription_tier !== 'premium') {
        if (serverCount !== undefined && serverCount >= FREE_TIER_LIMITS.dailyViews) {
          console.log('[Usage Tracking] Server reports daily view limit reached:', serverCount);
          setTodayUsage(prev => ({
            ...prev,
            propertiesViewed: serverCount,
          }));
          window.dispatchEvent(new CustomEvent('usage:updated', {
            detail: {
              todayUsage: {
                ...todayUsage,
                propertiesViewed: serverCount,
              },
            },
          }));
          return false;
        }
      }

      // Update viewed properties set
      const today = new Date().toISOString().split('T')[0];
      const newSet = new Set(viewedPropertiesToday).add(propertyId);
      setViewedPropertiesToday(newSet);
      localStorage.setItem(`viewedProperties_${today}`, JSON.stringify(Array.from(newSet)));

      // Update local state with new count (prefer server value if available)
      setTodayUsage(prev => {
        const newViewCount = serverCount !== undefined ? serverCount : prev.propertiesViewed + 1;
        
        // Broadcast update with new value
        window.dispatchEvent(new CustomEvent('usage:updated', {
          detail: {
            todayUsage: {
              ...prev,
              propertiesViewed: newViewCount,
            },
          },
        }));
        
        return {
          ...prev,
          propertiesViewed: newViewCount,
        };
      });

      console.log('[Usage Tracking] Successfully tracked unique property view:', propertyId);
      return true;
    } catch (error) {
      console.error('[Usage Tracking] Error updating property view:', error);
      return false;
    }
  }, [user?.id, viewedPropertiesToday, subscriptionStatus, todayUsage.propertiesViewed]);

  const updateUsage = async (
    type: 'view' | 'match' | 'quiz' | 'ai-search' | 'match-with-view'
  ) => {
    if (!user?.id) {
      console.log('[Usage Tracking] Cannot update usage - no user');
      return;
    }

    try {
      let redisType: string;
      switch (type) {
        case 'view':
          redisType = 'view';
          break;
        case 'match':
        case 'match-with-view':
          redisType = 'match';
          break;
        case 'quiz':
          redisType = 'quiz';
          break;
        case 'ai-search':
          redisType = 'ai-search';
          break;
        default:
          return;
      }

      console.log(`[Usage Tracking] Incrementing usage: ${redisType}`);

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
            type: redisType,
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
          case 'view':
            updated.propertiesViewed += 1;
            break;
          case 'match':
          case 'match-with-view':
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

      if (type === 'match' || type === 'match-with-view') {
        setWeeklyMatches(prev => prev + 1);
      }

      window.dispatchEvent(new CustomEvent('usage:updated'));

    } catch (error) {
      console.error('[Usage Tracking] Error in updateUsage:', error);
      toast.error('Failed to update usage');
    }
  };

  const canPerformAction = useCallback((type: 'view' | 'match' | 'quiz' | 'ai-search'): boolean => {
    // Don't block actions while subscription status is still loading
    if (loading) {
      console.log('[Usage Tracking] Still loading subscription status - allowing action');
      return true;
    }

    console.log(`[Usage Tracking] Checking if can perform ${type}:`, {
      subscribed: subscriptionStatus.subscribed,
      tier: subscriptionStatus.subscription_tier,
      todayViews: todayUsage.propertiesViewed,
      weeklyMatches,
      todayAiSearches: todayUsage.aiSearches
    });

    if (subscriptionStatus.subscribed && subscriptionStatus.subscription_tier === 'premium') {
      console.log('[Usage Tracking] Premium user - unlimited access');
      return true;
    }

    switch (type) {
      case 'view':
        const canView = todayUsage.propertiesViewed < FREE_TIER_LIMITS.dailyViews;
        console.log(`[Usage Tracking] Can view: ${canView} (${todayUsage.propertiesViewed}/${FREE_TIER_LIMITS.dailyViews})`);
        return canView;
      case 'match':
        const canMatch = weeklyMatches < FREE_TIER_LIMITS.weeklyMatches;
        console.log(`[Usage Tracking] Can match: ${canMatch} (${weeklyMatches}/${FREE_TIER_LIMITS.weeklyMatches})`);
        return canMatch;
      case 'quiz':
        return true;
      case 'ai-search':
        const canAiSearch = todayUsage.aiSearches < FREE_TIER_LIMITS.dailyAiRequests;
        console.log(`[Usage Tracking] Can AI search: ${canAiSearch} (${todayUsage.aiSearches}/${FREE_TIER_LIMITS.dailyAiRequests})`);
        return canAiSearch;
      default:
        return false;
    }
  }, [subscriptionStatus, todayUsage, weeklyMatches, loading]);

  const getRemainingActions = (type: 'view' | 'match' | 'quiz' | 'ai-search'): number => {
    if (subscriptionStatus.subscribed && subscriptionStatus.subscription_tier === 'premium') {
      return Infinity;
    }

    switch (type) {
      case 'view':
        return Math.max(0, FREE_TIER_LIMITS.dailyViews - todayUsage.propertiesViewed);
      case 'match':
        return Math.max(0, FREE_TIER_LIMITS.weeklyMatches - weeklyMatches);
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
    subscriptionStatus,
    loading,
    limits: FREE_TIER_LIMITS,
    updateUsage,
    updatePropertyView,
    canPerformAction,
    getRemainingActions,
    refetchUsage,
    FREE_TIER_LIMITS,
  };
};
