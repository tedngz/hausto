import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

interface UsageLimits {
  propertiesViewed: number;
  propertiesMatched: number;
  quizRetakes: number;
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
};

export const useUsageTracking = () => {
  const { user } = useAuth();
  const [todayUsage, setTodayUsage] = useState<UsageLimits>({
    propertiesViewed: 0,
    propertiesMatched: 0,
    quizRetakes: 0,
  });
  const [weeklyMatches, setWeeklyMatches] = useState(0);
  const [weeklyQuizRetakes, setWeeklyQuizRetakes] = useState(0);
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus>({
    subscribed: false,
    subscription_tier: 'free',
  });
  const [loading, setLoading] = useState(true);

  const fetchUsage = async () => {
    if (!user?.id) return;

    try {
      const today = new Date().toISOString().split('T')[0];
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      // Get today's usage
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
        });
      }

      // Get weekly matches and quiz retakes
      const { data: weeklyData } = await supabase
        .from('daily_usage')
        .select('properties_matched, quiz_retakes')
        .eq('user_id', user.id)
        .gte('usage_date', weekAgo);

      if (weeklyData) {
        const weeklyMatchesSum = weeklyData.reduce((sum, day) => sum + day.properties_matched, 0);
        const weeklyQuizRetakesSum = weeklyData.reduce((sum, day) => sum + day.quiz_retakes, 0);
        setWeeklyMatches(weeklyMatchesSum);
        setWeeklyQuizRetakes(weeklyQuizRetakesSum);
      }

      // Get subscription status
      const { data: subData } = await supabase
        .from('subscribers')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (subData) {
        setSubscriptionStatus({
          subscribed: subData.subscribed,
          subscription_tier: subData.subscription_tier,
          subscription_end: subData.subscription_end,
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

  const updateUsage = async (type: 'view' | 'match' | 'quiz') => {
    if (!user?.id) return false;

    const today = new Date().toISOString().split('T')[0];
    
    try {
      let updateData = {};
      switch (type) {
        case 'view':
          updateData = { properties_viewed: todayUsage.propertiesViewed + 1 };
          break;
        case 'match':
          updateData = { properties_matched: todayUsage.propertiesMatched + 1 };
          break;
        case 'quiz':
          updateData = { quiz_retakes: todayUsage.quizRetakes + 1 };
          break;
      }

      const { error } = await supabase
        .from('daily_usage')
        .upsert({
          user_id: user.id,
          usage_date: today,
          properties_viewed: todayUsage.propertiesViewed,
          properties_matched: todayUsage.propertiesMatched,
          quiz_retakes: todayUsage.quizRetakes,
          ...updateData,
        }, { 
          onConflict: 'user_id,usage_date',
          ignoreDuplicates: false 
        });

      if (error) {
        console.error('Error updating usage:', error);
        throw error;
      }

      // Update local state
      setTodayUsage(prev => ({
        ...prev,
        ...updateData,
      }));

      if (type === 'match') {
        setWeeklyMatches(prev => prev + 1);
      }
      if (type === 'quiz') {
        setWeeklyQuizRetakes(prev => prev + 1);
      }

      return true;
    } catch (error) {
      console.error('Error updating usage:', error);
      toast.error('Failed to update usage tracking');
      return false;
    }
  };

  const canPerformAction = (type: 'view' | 'match' | 'quiz'): boolean => {
    // Premium users have unlimited access
    if (subscriptionStatus.subscribed && subscriptionStatus.subscription_tier === 'premium') {
      return true;
    }

    // Check free tier limits
    switch (type) {
      case 'view':
        return todayUsage.propertiesViewed < FREE_TIER_LIMITS.dailyViews;
      case 'match':
        return weeklyMatches < FREE_TIER_LIMITS.weeklyMatches;
      case 'quiz':
        return weeklyQuizRetakes < FREE_TIER_LIMITS.weeklyQuizRetakes;
      default:
        return false;
    }
  };

  const getRemainingActions = (type: 'view' | 'match' | 'quiz'): number => {
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