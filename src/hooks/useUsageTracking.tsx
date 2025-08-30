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
  weeklyQuizRetakes: 2,
  dailyAiSearches: 3,
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
  const [weeklyQuizRetakes, setWeeklyQuizRetakes] = useState(0);
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
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      console.log('Fetching usage for date:', today);

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
          aiSearches: 0, // Will be tracked in separate table/logic
        });
      }

      // Get weekly matches and quiz retakes
      const { data: weeklyData, error: weeklyError } = await supabase
        .from('daily_usage')
        .select('properties_matched, quiz_retakes')
        .eq('user_id', user.id)
        .gte('usage_date', weekAgo);

      if (weeklyError) {
        console.error('Error fetching weekly usage:', weeklyError);
      } else {
        console.log('Weekly usage data:', weeklyData);
      }

      if (weeklyData) {
        const weeklyMatchesSum = weeklyData.reduce((sum, day) => sum + day.properties_matched, 0);
        const weeklyQuizRetakesSum = weeklyData.reduce((sum, day) => sum + day.quiz_retakes, 0);
        setWeeklyMatches(weeklyMatchesSum);
        setWeeklyQuizRetakes(weeklyQuizRetakesSum);
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

  const updateUsage = async (type: 'view' | 'match' | 'quiz' | 'ai-search') => {
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

      // Update weekly counters immediately
      if (type === 'match') {
        console.log('Incrementing weekly matches from', weeklyMatches, 'to', weeklyMatches + 1);
        setWeeklyMatches(prev => prev + 1);
      }
      if (type === 'quiz') {
        console.log('Incrementing weekly quiz retakes from', weeklyQuizRetakes, 'to', weeklyQuizRetakes + 1);
        setWeeklyQuizRetakes(prev => prev + 1);
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
      weeklyQuizRetakes
    });

    // Premium users have unlimited access
    if (subscriptionStatus.subscribed && subscriptionStatus.subscription_tier === 'premium') {
      console.log('Premium user - unlimited access');
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
      case 'quiz':
        const canQuiz = weeklyQuizRetakes < FREE_TIER_LIMITS.weeklyQuizRetakes;
        console.log(`Can quiz: ${canQuiz} (${weeklyQuizRetakes}/${FREE_TIER_LIMITS.weeklyQuizRetakes})`);
        return canQuiz;
      case 'ai-search':
        const canAiSearch = todayUsage.aiSearches < FREE_TIER_LIMITS.dailyAiSearches;
        console.log(`Can AI search: ${canAiSearch} (${todayUsage.aiSearches}/${FREE_TIER_LIMITS.dailyAiSearches})`);
        return canAiSearch;
      default:
        return false;
    }
  };

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
        return Math.max(0, FREE_TIER_LIMITS.weeklyQuizRetakes - weeklyQuizRetakes);
      case 'ai-search':
        return Math.max(0, FREE_TIER_LIMITS.dailyAiSearches - todayUsage.aiSearches);
      default:
        return 0;
    }
  };

  return {
    todayUsage,
    weeklyMatches,
    weeklyQuizRetakes,
    subscriptionStatus,
    loading,
    updateUsage,
    canPerformAction,
    getRemainingActions,
    refetchUsage: fetchUsage,
    limits: FREE_TIER_LIMITS,
  };
};