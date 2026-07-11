import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MessageCircleQuestion, CalendarCheck, Loader2, X, ChevronDown } from 'lucide-react';
import { useConciergeQueue, ConciergeEscalation, FastTrackQueueItem } from '@/hooks/useConciergeQueue';

const FAST_TRACK_STATUSES: FastTrackQueueItem['status'][] = [
  'pending',
  'in_progress',
  'scheduled',
  'completed',
  'cancelled',
];

const statusBadgeClass: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800 border-amber-200',
  in_progress: 'bg-blue-100 text-blue-800 border-blue-200',
  scheduled: 'bg-purple-100 text-purple-800 border-purple-200',
  completed: 'bg-green-100 text-green-800 border-green-200',
  cancelled: 'bg-gray-100 text-gray-600 border-gray-200',
  answered: 'bg-green-100 text-green-800 border-green-200',
};

const EscalationRow = ({
  escalation,
  onAnswer,
  onDismiss,
  isAnswering,
}: {
  escalation: ConciergeEscalation;
  onAnswer: (escalation: ConciergeEscalation, reply: string) => Promise<void>;
  onDismiss: (id: string) => void;
  isAnswering: boolean;
}) => {
  const [reply, setReply] = useState('');
  const [isReplying, setIsReplying] = useState(false);
  const isPending = escalation.status === 'pending';

  return (
    <div className="p-4 rounded-lg border border-border bg-card space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            {escalation.renter_name || 'A renter'}
            {escalation.property_title && (
              <span className="text-muted-foreground font-normal"> · {escalation.property_title}</span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {new Date(escalation.created_at).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge className={`border capitalize ${statusBadgeClass[escalation.status] || ''}`}>
            {escalation.status}
          </Badge>
          {isPending && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              aria-label="Dismiss question"
              onClick={() => onDismiss(escalation.id)}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      <blockquote className="text-sm text-foreground border-l-2 border-primary/50 pl-3">
        {escalation.question}
      </blockquote>
      {isPending && (
        <div className="space-y-2">
          <Textarea
            value={reply}
            onChange={e => setReply(e.target.value)}
            placeholder="Write your reply — it's sent straight into the renter's chat…"
            className="min-h-[70px] text-sm"
          />
          <Button
            size="sm"
            disabled={!reply.trim() || isAnswering || isReplying}
            onClick={async () => {
              setIsReplying(true);
              try {
                await onAnswer(escalation, reply.trim());
                setReply('');
              } finally {
                setIsReplying(false);
              }
            }}
          >
            {isReplying ? 'Sending…' : 'Send reply'}
          </Button>
        </div>
      )}
    </div>
  );
};

const FastTrackRow = ({
  request,
  onStatusChange,
}: {
  request: FastTrackQueueItem;
  onStatusChange: (id: string, status: FastTrackQueueItem['status']) => void;
}) => (
  <div className="p-4 rounded-lg border border-border bg-card space-y-2">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">
          {request.renter_name || 'A renter'}
        </p>
        <p className="text-xs text-muted-foreground line-clamp-2">
          {(request.property_titles || []).join(', ')}
        </p>
      </div>
      <Select
        value={request.status}
        onValueChange={value => onStatusChange(request.id, value as FastTrackQueueItem['status'])}
      >
        <SelectTrigger className="w-[130px] h-8 text-xs capitalize shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FAST_TRACK_STATUSES.map(status => (
            <SelectItem key={status} value={status} className="capitalize text-xs">
              {status.replace('_', ' ')}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
    <p className="text-xs text-muted-foreground">
      Dates: {(request.preferred_dates || []).join(', ')} · Times: {(request.preferred_times || []).join(', ')}
    </p>
    {request.special_requirements && (
      <p className="text-xs text-muted-foreground italic">
        "{request.special_requirements}"
      </p>
    )}
  </div>
);

export const ConciergeQueue = () => {
  const {
    escalations,
    fastTrackRequests,
    isLoading,
    answerEscalation,
    isAnswering,
    dismissEscalation,
    updateFastTrackStatus,
  } = useConciergeQueue();

  // Answered questions and closed viewing requests are hidden by default so
  // the queue stays short and the listings below stay within easy reach.
  const [showAnswered, setShowAnswered] = useState(false);
  const [showClosedRequests, setShowClosedRequests] = useState(false);

  const pendingEscalations = escalations.filter(e => e.status === 'pending');
  const answeredEscalations = escalations.filter(e => e.status === 'answered').slice(0, 10);
  const activeRequests = fastTrackRequests.filter(r => r.status === 'pending' || r.status === 'in_progress' || r.status === 'scheduled');
  const closedRequests = fastTrackRequests.filter(r => r.status === 'completed' || r.status === 'cancelled');

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Escalated questions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageCircleQuestion className="h-4 w-4 text-primary" />
            Renter questions
            {pendingEscalations.length > 0 && (
              <Badge className="bg-amber-100 text-amber-800 border border-amber-200">
                {pendingEscalations.length} pending
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 max-h-[480px] overflow-y-auto">
          {pendingEscalations.length === 0 && answeredEscalations.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No open questions — Hausto AI is handling renter chats.
            </p>
          ) : (
            <>
              {pendingEscalations.length === 0 && (
                <p className="text-sm text-muted-foreground py-2 text-center">
                  All caught up — no questions waiting on you.
                </p>
              )}
              {pendingEscalations.map(e => (
                <EscalationRow
                  key={e.id}
                  escalation={e}
                  onAnswer={answerEscalation}
                  onDismiss={dismissEscalation}
                  isAnswering={isAnswering}
                />
              ))}
              {answeredEscalations.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowAnswered(v => !v)}
                    className="w-full flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground py-1 transition-colors"
                  >
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAnswered ? 'rotate-180' : ''}`} />
                    {showAnswered ? 'Hide answered' : `Show answered (${answeredEscalations.length})`}
                  </button>
                  {showAnswered && answeredEscalations.map(e => (
                    <EscalationRow
                      key={e.id}
                      escalation={e}
                      onAnswer={answerEscalation}
                      onDismiss={dismissEscalation}
                      isAnswering={isAnswering}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Fast-Track viewing requests */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarCheck className="h-4 w-4 text-primary" />
            Viewing requests
            {fastTrackRequests.filter(r => r.status === 'pending').length > 0 && (
              <Badge className="bg-amber-100 text-amber-800 border border-amber-200">
                {fastTrackRequests.filter(r => r.status === 'pending').length} pending
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 max-h-[480px] overflow-y-auto">
          {fastTrackRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No viewing requests yet.
            </p>
          ) : (
            <>
              {activeRequests.length === 0 && (
                <p className="text-sm text-muted-foreground py-2 text-center">
                  No active viewing requests.
                </p>
              )}
              {activeRequests.map(request => (
                <FastTrackRow key={request.id} request={request} onStatusChange={updateFastTrackStatus} />
              ))}
              {closedRequests.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowClosedRequests(v => !v)}
                    className="w-full flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground py-1 transition-colors"
                  >
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showClosedRequests ? 'rotate-180' : ''}`} />
                    {showClosedRequests ? 'Hide completed & cancelled' : `Show completed & cancelled (${closedRequests.length})`}
                  </button>
                  {showClosedRequests && closedRequests.map(request => (
                    <FastTrackRow key={request.id} request={request} onStatusChange={updateFastTrackStatus} />
                  ))}
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
