import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CalendarCheck } from 'lucide-react';
import { useConciergeQueue } from '@/hooks/useConciergeQueue';
import { ViewingRequestsManager } from '@/components/ViewingRequestsManager';

// Realtor-side viewing coordination, plus a way into the renter questions the
// assistant could not answer (those open in RenterQuestionsDialog, which the
// parent owns - the chat banner that used to open it is gone).
export const ConciergeQueue = ({ onOpenQuestions }: { onOpenQuestions?: () => void }) => {
  const { fastTrackRequests, pendingCount } = useConciergeQueue();
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
      <CardContent className="space-y-3">
        {onOpenQuestions && pendingCount > 0 && (
          <button
            onClick={onOpenQuestions}
            className="w-full flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left text-sm text-amber-900 transition-colors hover:bg-amber-100"
          >
            <span className="flex-1">
              {pendingCount} renter question{pendingCount === 1 ? '' : 's'} we couldn't answer
            </span>
            <span className="text-xs font-medium underline underline-offset-2">Review</span>
          </button>
        )}
        <ViewingRequestsManager scope="realtor" />
      </CardContent>
    </Card>
  );
};
