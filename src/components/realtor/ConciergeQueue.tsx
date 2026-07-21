import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CalendarCheck } from 'lucide-react';
import { useConciergeQueue } from '@/hooks/useConciergeQueue';
import { ViewingRequestsManager } from '@/components/ViewingRequestsManager';

// Realtor-side viewing coordination. Renter questions no longer live here -
// Hausto chat notifies the realtor about unresolved questions instead
// (see RenterQuestionsDialog, opened from the chat banner).
export const ConciergeQueue = () => {
  const { fastTrackRequests } = useConciergeQueue();
  const pending = fastTrackRequests.filter(r => r.status === 'pending').length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarCheck className="h-4 w-4 text-primary" />
          Viewing requests
          {pending > 0 && (
            <Badge className="bg-amber-100 text-amber-800 border border-amber-200">
              {pending} pending
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ViewingRequestsManager scope="realtor" />
      </CardContent>
    </Card>
  );
};
