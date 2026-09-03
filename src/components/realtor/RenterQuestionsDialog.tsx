import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { X } from 'lucide-react';
import { useConciergeQueue, ConciergeEscalation } from '@/hooks/useConciergeQueue';
import { ListingCardDialog } from '@/components/ListingCardDialog';

// Renter questions escalated by Hausto Agent, answered from inside the chat
// surface (opened via the unresolved-questions banner) instead of cluttering
// the realtor dashboard. Replies land straight in the renter's chat thread.

const QuestionRow = ({
  escalation,
  onAnswer,
  onDismiss,
  onPreviewProperty,
}: {
  escalation: ConciergeEscalation;
  onAnswer: (e: ConciergeEscalation, reply: string) => Promise<void>;
  onDismiss: (id: string) => void;
  onPreviewProperty: (propertyId: string) => void;
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
              <>
                <span className="text-muted-foreground font-normal"> · </span>
                {escalation.property_id ? (
                  <button
                    type="button"
                    onClick={() => onPreviewProperty(escalation.property_id!)}
                    className="text-muted-foreground font-normal text-left underline decoration-border underline-offset-4 hover:text-primary hover:decoration-primary transition-colors"
                  >
                    {escalation.property_title}
                  </button>
                ) : (
                  <span className="text-muted-foreground font-normal">{escalation.property_title}</span>
                )}
              </>
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
  const { escalations, dismissEscalation } = useConciergeQueue();
  const queryClient = useQueryClient();
  const [previewPropertyId, setPreviewPropertyId] = useState<string | null>(null);
  const pending = escalations.filter((e) => e.status === 'pending');

  // Route answers through the edge function: it emails the renter the question
  // context, the answer and a property link. Email is the only channel now.
  const answerEscalation = async (escalation: ConciergeEscalation, reply: string) => {
    const { data, error } = await supabase.functions.invoke('concierge-answer', {
      body: { escalationId: escalation.id, reply },
    });
    if (error || data?.error) {
      toast.error('Failed to send reply', { description: (error?.message || data?.error) });
      throw new Error(error?.message || data?.error);
    }
    queryClient.invalidateQueries({ queryKey: ['concierge-queue-escalations'] });
    queryClient.invalidateQueries({ queryKey: ['pending-renter-questions'] });
    toast.success('Reply sent to the renter.', {
      description: data?.emailDelivered ? 'Delivered in chat and by email.' : 'Delivered in chat.',
    });
  };

  return (
    <>
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
            Questions Hausto Agent escalated to you. Your reply lands in the renter's chat.
          </DialogDescription>
        </DialogHeader>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            All caught up - Hausto Agent is handling renter chats.
          </p>
        ) : (
          <div className="space-y-3">
            {pending.map((e) => (
              <QuestionRow
                key={e.id}
                escalation={e}
                onAnswer={answerEscalation}
                onDismiss={dismissEscalation}
                onPreviewProperty={setPreviewPropertyId}
              />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>

    <ListingCardDialog
      propertyId={previewPropertyId}
      open={!!previewPropertyId}
      onOpenChange={(o) => { if (!o) setPreviewPropertyId(null); }}
    />
    </>
  );
};
