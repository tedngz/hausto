import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calendar, CreditCard, History } from 'lucide-react';
import { useSubscription } from '@/hooks/useSubscription';
import { format } from 'date-fns';

export const SubscriptionHistory = () => {
  const { subscribed, subscription_tier, subscription_end, loading } = useSubscription();

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-muted rounded w-1/2"></div>
            <div className="h-8 bg-muted rounded w-1/4"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const isPremium = subscribed && subscription_tier === 'premium';

  // Mock history data - in a real app, this would come from the database
  const subscriptionHistory = [
    {
      id: '1',
      date: subscription_end || new Date().toISOString(),
      type: 'subscription',
      status: isPremium ? 'active' : 'inactive',
      amount: '$9.99',
      description: isPremium ? 'Premium Monthly Subscription - Active' : 'Premium Monthly Subscription - Cancelled'
    }
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-5 w-5" />
          Subscription History
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {subscriptionHistory.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <CreditCard className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No subscription history found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {subscriptionHistory.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <CreditCard className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <div className="font-medium">{item.description}</div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      {subscription_end ? format(new Date(subscription_end), 'MMM dd, yyyy') : 'Unknown date'}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-medium">{item.amount}</div>
                  <Badge 
                    variant={item.status === 'active' ? 'default' : 'secondary'}
                    className="text-xs"
                  >
                    {item.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};