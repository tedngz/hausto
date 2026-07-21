import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { X } from 'lucide-react';
import { useConciergeQueue, ConciergeEscalation } from '@/hooks/useConciergeQueue';

// Renter questions escalated by Hausto AI, answered from inside the chat
// surface (opened via the unresolved-questions banner) instead of cluttering
// the realtor dashboard. Replies land straight in the renter's chat thread.

const QuestionRow = ({
  escalation,
  onAnswer,
  onDismiss,
}: {
  escalation: ConciergeEscalation;
  onAnswer: (e: ConciergeEscalation, reply: string) => Promise<void>;
  onDismiss: (id: string) => void;
}) => {
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  return (
    <div className="p-3 rounded-lg border bg-card space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {escalation.renter_name || 'A renter'}
            {escalation.property_title && (
              <span className="text-muted-foreground font-normal"> · {escalation.property_title}</span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">{new Date(escalation.created_at).toLocaleString()}</p>
        </div>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0" aria-label="Dismiss question" onClick={() => onDismiss(escalation.id)}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <blockquote className="text-sm border-l-2 border-primary/50 pl-3">{escalation.question}</blockquote>
      <Textarea
        value={reply}
        onChange={(e) => setReply(e.target.value)}
        placeholder="Write your reply - it's sent straight into the renter's chat..."
        className="min-h-[60px] text-sm"
      />
      <Button
        size="sm"
        disabled={!reply.trim() || sending}
        onClick={async () => {
          setSending(true);
          try {
            await onAnswer(escalation, reply.trim());
            setReply('');
          } finally {
            setSending(false);
          }
        }}
      >
        {sending ? 'Sending...' : 'Send reply'}
      </Button>
    </div>
  );
};

export const RenterQuestionsDialog = ({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) => {
  const { escalations, answerEscalation, dismissEscalation } = useConciergeQueue();
  const pending = escalations.filter((e) => e.status === 'pending');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Unresolved renter questions
            {pending.length > 0 && (
              <Badge className="bg-amber-100 text-amber-800 border border-amber-200">{pending.length}</Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Questions Hausto AI escalated to you. Your reply lands in the renter's chat.
          </DialogDescription>
        </DialogHeader>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            All caught up - Hausto AI is handling renter chats.
          </p>
        ) : (
          <div className="space-y-3">
            {pending.map((e) => (
              <QuestionRow key={e.id} escalation={e} onAnswer={answerEscalation} onDismiss={dismissEscalation} />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
