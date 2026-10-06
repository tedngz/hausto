import { useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { CalendarCheck, MessageSquare } from 'lucide-react';
import { useUsageTracking } from '@/hooks/useUsageTracking';
 
export const UsageMeter = () => {
  const {
    todayUsage,
    hasUnlimitedAi,
    loading,
    limits,
    refetchUsage,
  } = useUsageTracking();

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

  // Only AI searches carry a ceiling now. The per-listing view budget went with
  // the swipe deck, and matches are uncapped on every tier - a bar that can
  // never fill is worse than no bar.
  const usageItems = [
    {
      icon: MessageSquare,
      label: 'Daily AI requests',
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
          const percentage = hasUnlimitedAi ? 0 : Math.min((item.current / item.limit) * 100, 100);
          const isAtLimit = !hasUnlimitedAi && item.current >= item.limit;
          
          return (
            <div key={item.label} className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${item.color}`} />
                  <span className="font-medium">{item.label}</span>
                </div>
                <span className={`font-mono ${isAtLimit ? 'text-red-500' : 'text-muted-foreground'}`}>
                  {hasUnlimitedAi ? '∞' : `${item.current}/${item.limit}`}
                </span>
              </div>
              {!hasUnlimitedAi && (
                <Progress 
                  value={percentage} 
                  className={`h-2 ${isAtLimit ? '[&>div]:bg-red-500' : ''}`}
                />
              )}
              {hasUnlimitedAi && (
                <div className="h-2 bg-primary/20 rounded-full">
                  <div className="h-full bg-gradient-to-r from-primary to-primary/60 rounded-full animate-pulse"></div>
                </div>
              )}
            </div>
          );
        })}

        {/* Viewings have no meter since the pricing rework: requests are free,
            and what a renter pays for is locking in a plan agents confirmed. */}
        <div className="flex items-start gap-2 text-sm">
          <CalendarCheck className="h-4 w-4 mt-0.5 text-orange-500 shrink-0" />
          <span className="text-muted-foreground">
            Viewing requests are free. Your first confirmed viewing is on us; the Pass covers every one after.
          </span>
        </div>
      </CardContent>
    </Card>
  );
};