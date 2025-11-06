import { useState, useEffect } from 'react';
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
  const { user } = useAuth();
  const [todayUsage, setTodayUsage] = useState<UsageLimits>({
    propertiesViewed: 0,
    propertiesMatched: 0,
    quizRetakes: 0,
    aiSearches: 0,
  });
  const [weeklyMatches, setWeeklyMatches] = useState(0);
  const [viewedPropertiesToday, setViewedPropertiesToday] = useState<Set<string>>(() => {
    // Load viewed properties from localStorage on initialization
    const today = new Date().toISOString().split('T')[0];
    const stored = localStorage.getItem(`viewedProperties_${today}`);
    return stored ? new Set(JSON.parse(stored)) : new Set();
  });
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus>({
    subscribed: false,
    subscription_tier: 'free',
  });
  const [loading, setLoading] = useState(true);

  const fetchUsage = async () => {
    if (!user?.id) {
      console.log('No user available for fetchUsage, user:', user);
      return;
    }

    console.log('Fetching usage for user:', user.id);

    try {
      const today = new Date().toISOString().split('T')[0];
      // Calculate exactly 7 days ago (including today = 7 days total)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
      const weekAgo = sevenDaysAgo.toISOString().split('T')[0];

      console.log('Fetching usage for date range:', { today, weekAgo });

      // Load viewed properties from localStorage for today, or reset if it's a new day
      const stored = localStorage.getItem(`viewedProperties_${today}`);
      const viewedSet = stored ? new Set<string>(JSON.parse(stored) as string[]) : new Set<string>();
      setViewedPropertiesToday(viewedSet);

      // Clean up old viewed properties from localStorage (keep only today's)
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('viewedProperties_') && key !== `viewedProperties_${today}`) {
          localStorage.removeItem(key);
        }
      });

      // Get today's usage
      const { data: todayData, error: todayError } = await supabase
        .from('daily_usage')
        .select('*')
        .eq('user_id', user.id)
        .eq('usage_date', today)
        .maybeSingle();

      if (todayError) {
        console.error('Error fetching today\'s usage:', todayError);
      } else {
        console.log('Today\'s usage data:', todayData);
      }

      if (todayData) {
        setTodayUsage({
          propertiesViewed: todayData.properties_viewed,
          propertiesMatched: todayData.properties_matched,
          quizRetakes: todayData.quiz_retakes,
          aiSearches: todayData.ai_requests || 0,
        });
      } else {
        // Reset to zero if no data for today
        setTodayUsage({
          propertiesViewed: 0,
          propertiesMatched: 0,
          quizRetakes: 0,
          aiSearches: 0,
        });
      }

      // Get weekly matches (last 7 days including today)
      const { data: weeklyData, error: weeklyError } = await supabase
        .from('daily_usage')
        .select('usage_date, properties_matched')
        .eq('user_id', user.id)
        .gte('usage_date', weekAgo)
        .lte('usage_date', today)
        .order('usage_date', { ascending: true });

      if (weeklyError) {
        console.error('Error fetching weekly usage:', weeklyError);
      } else {
        console.log('Weekly usage data:', weeklyData);
      }

      if (weeklyData) {
        const weeklyMatchesSum = weeklyData.reduce((sum, day) => sum + day.properties_matched, 0);
        console.log('Weekly totals calculated:', { weeklyMatchesSum });
        setWeeklyMatches(weeklyMatchesSum);
      }

      // Get subscription status
      const { data: subData, error: subError } = await supabase
        .from('subscribers')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (subError) {
        console.error('Error fetching subscription:', subError);
      } else {
        console.log('Subscription data:', subData);
      }

      if (subData) {
        setSubscriptionStatus({
          subscribed: subData.subscribed,
          subscription_tier: subData.subscription_tier,
          subscription_end: subData.subscription_end,
        });
      } else {
        // If no subscription record, ensure user shows as free tier
        setSubscriptionStatus({
          subscribed: false,
          subscription_tier: 'free',
        });
      }
    } catch (error) {
      console.error('Error fetching usage data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsage();
  }, [user?.id]);

  // Listen for cross-component usage updates
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
      // As a fallback, re-fetch to stay consistent with DB
      if (!detail.todayUsage) {
        fetchUsage();
      }
    };
    window.addEventListener('usage:updated', handler as EventListener);
    return () => window.removeEventListener('usage:updated', handler as EventListener);
  }, []);


  // Add new function to track unique property views
  const updatePropertyView = async (propertyId: string) => {
    if (!user?.id || !propertyId) {
      console.error('No user ID or property ID available for view tracking');
      return false;
    }

    // Check if this property was already viewed today
    if (viewedPropertiesToday.has(propertyId)) {
      console.log('Property already viewed today, not counting again:', propertyId);
      return true;
    }

    // Track the view directly
    const today = new Date().toISOString().split('T')[0];
    const newViews = todayUsage.propertiesViewed + 1;
    
    try {
      const { error } = await supabase
        .from('daily_usage')
        .upsert({
          user_id: user.id,
          usage_date: today,
          properties_viewed: newViews,
          properties_matched: todayUsage.propertiesMatched,
          quiz_retakes: todayUsage.quizRetakes,
          ai_requests: todayUsage.aiSearches,
        }, { 
          onConflict: 'user_id,usage_date',
          ignoreDuplicates: false 
        });

      if (error) {
        console.error('Supabase error updating property view:', error);
        return false;
      }

      // Update local state
      const updatedTodayUsage = {
        propertiesViewed: newViews,
        propertiesMatched: todayUsage.propertiesMatched,
        quizRetakes: todayUsage.quizRetakes,
        aiSearches: todayUsage.aiSearches,
      };
      setTodayUsage(updatedTodayUsage);
      
      // Update the Set and persist to localStorage
      const newSet = new Set(viewedPropertiesToday).add(propertyId);
      setViewedPropertiesToday(newSet);
      localStorage.setItem(`viewedProperties_${today}`, JSON.stringify(Array.from(newSet)));

      // Broadcast usage update so other components refresh their counters immediately
      window.dispatchEvent(new CustomEvent('usage:updated', { detail: {
        todayUsage: updatedTodayUsage,
        weeklyMatches,
      }}));

      console.log('Successfully tracked unique property view for:', propertyId);
      return true;
    } catch (error) {
      console.error('Error updating property view:', error);
      return false;
    }
  };

  const updateUsage = async (type: 'view' | 'match' | 'quiz' | 'ai-search' | 'match-with-view') => {
    if (!user?.id) {
      console.error('No user ID available for usage tracking');
      return false;
    }

    const today = new Date().toISOString().split('T')[0];
    
    try {
      // Calculate new values
      let newViews = todayUsage.propertiesViewed;
      let newMatches = todayUsage.propertiesMatched;
      let newQuizRetakes = todayUsage.quizRetakes;
      let newAiSearches = todayUsage.aiSearches;

      switch (type) {
        case 'view':
          newViews += 1;
          break;
        case 'match':
          newMatches += 1;
          break;
        case 'match-with-view':
          newMatches += 1;
          newViews += 1;
          break;
        case 'quiz':
          newQuizRetakes += 1;
          break;
        case 'ai-search':
          newAiSearches += 1;
          break;
      }

      console.log('Updating usage:', { type, user_id: user.id, usage_date: today, newViews, newMatches, newQuizRetakes });

      const { error } = await supabase
        .from('daily_usage')
        .upsert({
          user_id: user.id,
          usage_date: today,
          properties_viewed: newViews,
          properties_matched: newMatches,
          quiz_retakes: newQuizRetakes,
          ai_requests: newAiSearches,
        }, { 
          onConflict: 'user_id,usage_date',
          ignoreDuplicates: false 
        });

      if (error) {
        console.error('Supabase error updating usage:', error);
        toast.error(`Failed to track ${type}: ${error.message}`);
        return false;
      }

      console.log('Successfully updated usage tracking for', type);

      // Update local state
      setTodayUsage({
        propertiesViewed: newViews,
        propertiesMatched: newMatches,
        quizRetakes: newQuizRetakes,
        aiSearches: newAiSearches,
      });

      // Notify listeners (e.g., UsageMeter) to refresh
      window.dispatchEvent(new CustomEvent('usage:updated'));

      // Update weekly counters immediately only after successful database update
      if (type === 'match' || type === 'match-with-view') {
        console.log('Incrementing weekly matches from', weeklyMatches, 'to', weeklyMatches + 1);
        setWeeklyMatches(prev => prev + 1);
      }

      return true;
    } catch (error) {
      console.error('Error updating usage:', error);
      toast.error('Failed to update usage tracking');
      return false;
    }
  };

  const canPerformAction = (type: 'view' | 'match' | 'quiz' | 'ai-search'): boolean => {
    console.log(`Checking if can perform ${type}:`, {
      subscribed: subscriptionStatus.subscribed,
      tier: subscriptionStatus.subscription_tier,
      todayViews: todayUsage.propertiesViewed,
      weeklyMatches,
      todayAiSearches: todayUsage.aiSearches
    });

    // Premium users have unlimited access
    if (subscriptionStatus.subscribed && subscriptionStatus.subscription_tier === 'premium') {
      console.log('Premium user - unlimited access');
      return true;
    }

    // Quiz is now unlimited for all users
    if (type === 'quiz') {
      return true;
    }

    // Check free tier limits
    switch (type) {
      case 'view':
        const canView = todayUsage.propertiesViewed < FREE_TIER_LIMITS.dailyViews;
        console.log(`Can view: ${canView} (${todayUsage.propertiesViewed}/${FREE_TIER_LIMITS.dailyViews})`);
        return canView;
      case 'match':
        const canMatch = weeklyMatches < FREE_TIER_LIMITS.weeklyMatches;
        console.log(`Can match: ${canMatch} (${weeklyMatches}/${FREE_TIER_LIMITS.weeklyMatches})`);
        return canMatch;
      case 'ai-search':
        const canAiSearch = todayUsage.aiSearches < FREE_TIER_LIMITS.dailyAiRequests;
        console.log(`Can AI search: ${canAiSearch} (${todayUsage.aiSearches}/${FREE_TIER_LIMITS.dailyAiRequests})`);
        return canAiSearch;
      default:
        return false;
    }
  };

  const getRemainingActions = (type: 'view' | 'match' | 'quiz' | 'ai-search'): number => {
    if (subscriptionStatus.subscribed && subscriptionStatus.subscription_tier === 'premium') {
      return Infinity;
    }

    // Quiz is now unlimited for all users
    if (type === 'quiz') {
      return Infinity;
    }

    switch (type) {
      case 'view':
        return Math.max(0, FREE_TIER_LIMITS.dailyViews - todayUsage.propertiesViewed);
      case 'match':
        return Math.max(0, FREE_TIER_LIMITS.weeklyMatches - weeklyMatches);
      case 'ai-search':
        return Math.max(0, FREE_TIER_LIMITS.dailyAiRequests - todayUsage.aiSearches);
      default:
        return 0;
    }
  };

  return {
    todayUsage,
    weeklyMatches,
    subscriptionStatus,
    loading,
    updateUsage,
    updatePropertyView,
    canPerformAction,
    getRemainingActions,
    refetchUsage: fetchUsage,
    limits: FREE_TIER_LIMITS,
  };
};