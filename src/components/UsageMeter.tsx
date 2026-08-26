import { useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { CalendarCheck, Heart, RotateCcw, Crown, MessageSquare } from 'lucide-react';
import { useUsageTracking } from '@/hooks/useUsageTracking';
import { useViewingQuota } from '@/hooks/useViewingQuota';
 
export const UsageMeter = () => {
  const {
    todayUsage,
    weeklyMatches,
    subscriptionStatus,
    loading,
    limits,
    refetchUsage,
  } = useUsageTracking();
  const { quota } = useViewingQuota();

  useEffect(() => {
    const handler = () => {
      refetchUsage();
    };
    window.addEventListener('usage:updated', handler);
    return () => window.removeEventListener('usage:updated', handler);
  }, [refetchUsage]);

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-muted rounded w-1/2"></div>
            <div className="h-2 bg-muted rounded"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const isPremium = subscriptionStatus.subscribed && subscriptionStatus.subscription_tier === 'premium';

  // No swipe deck any more, so no per-listing view budget to report: the meter
  // showed a bar that could only ever read 0/10.
  const usageItems = [
    {
      icon: Heart,
      label: 'Weekly matches',
      current: weeklyMatches,
      limit: limits.weeklyMatches,
      color: 'text-red-500',
    },
    {
      icon: MessageSquare,
      label: 'Daily AI searches',
      current: todayUsage.aiSearches,
      limit: limits.dailyAiRequests,
      color: 'text-green-500',
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-lg">
          Usage Overview
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {usageItems.map((item) => {
          const Icon = item.icon;
          const percentage = isPremium ? 0 : Math.min((item.current / item.limit) * 100, 100);
          const isAtLimit = !isPremium && item.current >= item.limit;
          
          return (
            <div key={item.label} className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${item.color}`} />
                  <span className="font-medium">{item.label}</span>
                </div>
                <span className={`font-mono ${isAtLimit ? 'text-red-500' : 'text-muted-foreground'}`}>
                  {isPremium ? '∞' : `${item.current}/${item.limit}`}
                </span>
              </div>
              {!isPremium && (
                <Progress 
                  value={percentage} 
                  className={`h-2 ${isAtLimit ? '[&>div]:bg-red-500' : ''}`}
                />
              )}
              {isPremium && (
                <div className="h-2 bg-primary/20 rounded-full">
                  <div className="h-full bg-gradient-to-r from-primary to-primary/60 rounded-full animate-pulse"></div>
                </div>
              )}
            </div>
          );
        })}

        {/* Viewing coordination sits outside the map: it isn't unlimited on
            premium (3 a cycle), and on the free tier it's the one-off trial. */}
        {quota && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <CalendarCheck className="h-4 w-4 text-orange-500" />
                <span className="font-medium">
                  {quota.isTrial ? 'Free viewing coordination' : 'Viewing coordinations'}
                </span>
              </div>
              <span className={`font-mono ${!quota.unlimited && !quota.canBook ? 'text-red-500' : 'text-muted-foreground'}`}>
                {quota.unlimited ? '∞' : `${Math.min(quota.used, quota.included)}/${quota.included}`}
              </span>
            </div>
            {quota.unlimited ? (
              <div className="h-2 bg-primary/20 rounded-full">
                <div className="h-full bg-gradient-to-r from-primary to-primary/60 rounded-full animate-pulse"></div>
              </div>
            ) : (
              <Progress
                value={Math.min((quota.used / quota.included) * 100, 100)}
                className={`h-2 ${!quota.canBook ? '[&>div]:bg-red-500' : ''}`}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};