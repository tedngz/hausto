import { useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { CalendarCheck, RotateCcw, Crown, MessageSquare } from 'lucide-react';
import { useUsageTracking } from '@/hooks/useUsageTracking';
import { useViewingQuota } from '@/hooks/useViewingQuota';
 
export const UsageMeter = () => {
  const {
    todayUsage,
    hasUnlimitedAi,
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

  // Only AI searches carry a ceiling now. The per-listing view budget went with
  // the swipe deck, and matches are uncapped on every tier - a bar that can
  // never fill is worse than no bar.
  const usageItems = [
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

        {/* Viewing coordination sits outside the map: it's 3 a cycle on premium,
            10 a month on the viewing pack, and a one-off trial on the free tier. */}
        {quota && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <CalendarCheck className="h-4 w-4 text-orange-500" />
                <span className="font-medium">
                  {quota.isTrial ? 'Free viewing coordination' : 'Viewing coordinations'}
                </span>
                {/* Locked reads as 1/1 spent otherwise - say why it's not on offer yet. */}
                {quota.trialLocked && (
                  <Badge variant="secondary" className="text-[10px]">
                    {quota.trialGate.hasPreferences
                      ? `${quota.trialGate.matchesNeeded - quota.trialGate.matchCount} more matches to unlock`
                      : 'Finish your preferences to unlock'}
                  </Badge>
                )}
              </div>
              <span className={`font-mono ${!quota.canBook ? 'text-red-500' : 'text-muted-foreground'}`}>
                {`${Math.min(quota.used, quota.included)}/${quota.included}`}
              </span>
            </div>
            <Progress
              value={Math.min((quota.used / quota.included) * 100, 100)}
              className={`h-2 ${!quota.canBook ? '[&>div]:bg-red-500' : ''}`}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
};