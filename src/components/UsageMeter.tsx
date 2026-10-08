import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { CalendarCheck, MessageSquare } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUsageTracking } from '@/hooks/useUsageTracking';

interface FreeViewing {
  hasPass: boolean;
  /** 0 or 1, out of the one free place. */
  used: number;
}

/**
 * The free viewing, as `viewing-request-open` reports it (requestGate's inputs,
 * SPEC §9). Spent once a plan on one of the account's numbers locked in free;
 * and counted while a request is still being worked, because until it ends a
 * second request would wait behind it or need the Pass. A request that lapses
 * without being locked in hands it back. Null when the lookup fails.
 */
function useFreeViewing() {
  const { user } = useAuth();
  return useQuery<FreeViewing | null>({
    queryKey: ['free-viewing', user?.id],
    enabled: !!user,
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('viewing-request-open', { body: {} });
      if (error || !data) return null;
      const d = data as { hasPass?: boolean; freeViewingAvailable?: boolean | null; open?: unknown; blocking?: unknown };
      return {
        hasPass: !!d.hasPass,
        used: d.freeViewingAvailable === false || !!d.open || !!d.blocking ? 1 : 0,
      };
    },
  });
}

export const UsageMeter = () => {
  const {
    todayUsage,
    hasUnlimitedAi,
    loading,
    limits,
    refetchUsage,
  } = useUsageTracking();
  const { user } = useAuth();
  const { data: viewing, isLoading: viewingLoading } = useFreeViewing();

  useEffect(() => {
    const handler = () => {
      refetchUsage();
    };
    window.addEventListener('usage:updated', handler);
    return () => window.removeEventListener('usage:updated', handler);
  }, [refetchUsage]);

  if (loading || (user && viewingLoading)) {
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

  // AI searches carry a daily ceiling; viewings one free place per WhatsApp
  // number, then the Pass (requestGate). The per-listing view budget went with
  // the swipe deck, and matches are uncapped on every tier - a bar that can
  // never fill is worse than no bar.
  const hasPass = hasUnlimitedAi || !!viewing?.hasPass;
  const usageItems = [
    {
      icon: MessageSquare,
      label: 'Daily AI credits',
      current: todayUsage.aiSearches,
      limit: limits.dailyAiRequests,
      unlimited: hasUnlimitedAi,
      color: 'text-green-500',
    },
    ...(viewing
      ? [{
        icon: CalendarCheck,
        label: hasPass ? 'Viewings' : 'Free viewing',
        current: viewing.used,
        limit: 1,
        unlimited: hasPass,
        color: 'text-orange-500',
      }]
      : []),
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
          const percentage = item.unlimited ? 0 : Math.min((item.current / item.limit) * 100, 100);
          const isAtLimit = !item.unlimited && item.current >= item.limit;

          return (
            <div key={item.label} className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${item.color}`} />
                  <span className="font-medium">{item.label}</span>
                </div>
                <span className={`font-mono ${isAtLimit ? 'text-red-500' : 'text-muted-foreground'}`}>
                  {item.unlimited ? '∞' : `${item.current}/${item.limit}`}
                </span>
              </div>
              {!item.unlimited && (
                <Progress
                  value={percentage}
                  className={`h-2 ${isAtLimit ? '[&>div]:bg-red-500' : ''}`}
                />
              )}
              {item.unlimited && (
                <div className="h-2 bg-primary/20 rounded-full">
                  <div className="h-full bg-gradient-to-r from-primary to-primary/60 rounded-full animate-pulse"></div>
                </div>
              )}
            </div>
          );
        })}

        {!hasPass && (
          <div className="flex items-start gap-2 text-sm">
            {/* With no bar to say it, the line carries the icon. */}
            {!viewing && <CalendarCheck className="h-4 w-4 mt-0.5 text-orange-500 shrink-0" />}
            <span className="text-muted-foreground">
              {viewing
                ? 'After your free viewing, the Pass has us arrange every one.'
                : 'Your first viewing is on us. After that, the Pass has us arrange every one.'}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
