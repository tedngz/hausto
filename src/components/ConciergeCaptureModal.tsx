import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, MessageCircle } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  complexId: string;
  complexName: string;
}

interface WhatsAppHandoff { code: string; waLink: string; alertsUntil: string }

const LEASES = [6, 12, 24] as const;
const BEDROOMS = [1, 2, 3, 4] as const;

const vnd = (dong: number) => `${dong.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ₫`;
// A rough guide for renters who think in dollars - the listings they have seen
// elsewhere often are. Never stored.
const usd = (dong: number) => `US$${(Math.round(dong / 25_000 / 50) * 50).toLocaleString('en-US')}`;

/** Today in Ho Chi Minh City, `YYYY-MM-DD`. */
const hcmcToday = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

/**
 * "Request availability at Empire City" (SPEC §11).
 *
 * A person on our team asks the agents who hold units in the building and
 * replies on WhatsApp within 24 hours. One form, then one message: the renter
 * sends us the text WhatsApp opens with. That message is the opt-in and proves
 * the number is theirs, so the form never asks for one - any country's works -
 * and the concierge's 24 hours start when it arrives.
 */
export function ConciergeCaptureModal({ open, onOpenChange, complexId, complexName }: Props) {
  const { user } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);
  const [handoff, setHandoff] = useState<WhatsAppHandoff | null>(null);

  const [moveIn, setMoveIn] = useState('');
  const [lease, setLease] = useState<number>(12);
  const [bedrooms, setBedrooms] = useState<number>(2);
  const [budgetMillions, setBudgetMillions] = useState('');
  const [hasPets, setHasPets] = useState(false);
  const [notes, setNotes] = useState('');
  const [name, setName] = useState('');

  const reset = () => {
    setError(null); setHandoff(null); setSubmitting(false);
    setMoveIn(''); setLease(12); setBedrooms(2); setBudgetMillions(''); setHasPets(false); setNotes('');
    setName(''); setPrefilled(false);
  };

  // Logged-in renters shouldn't retype what Hausto already knows.
  useEffect(() => {
    if (!open || !user || prefilled) return;
    let cancelled = false;
    (async () => {
      const { data: profile } = await supabase.from('profiles').select('name').eq('id', user.id).maybeSingle();
      if (cancelled) return;
      setName(prev => prev || profile?.name || user.user_metadata?.name || '');
      setPrefilled(true);
    })();
    return () => { cancelled = true; };
  }, [open, user, prefilled]);

  const close = () => { onOpenChange(false); setTimeout(reset, 300); };

  const budgetVnd = budgetMillions.trim() ? Math.round(Number(budgetMillions) * 1_000_000) : null;
  const budgetValid = budgetVnd !== null && Number.isFinite(budgetVnd) && budgetVnd >= 3_000_000 && budgetVnd <= 500_000_000;
  const canSubmit = !!moveIn && moveIn >= hcmcToday() && budgetValid && !!name.trim();

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const { data, error: fnError } = await supabase.functions.invoke('complex-inquiry-create', {
      body: {
        complexId,
        name: name.trim(),
        moveInDate: moveIn,
        leaseMonths: lease,
        bedrooms,
        budgetMaxVnd: budgetVnd,
        hasPets,
        notes: notes.trim() || null,
      },
    });
    setSubmitting(false);
    if (fnError || !data?.success) {
      let message = 'Could not send your request. Try again in a moment.';
      // supabase-js hides a non-2xx body behind `context`; the function's own
      // message says what to fix.
      try {
        const body = await (fnError as { context?: Response })?.context?.json();
        if (body?.message) message = body.message;
      } catch { /* keep the generic message */ }
      setError(message);
      return;
    }
    setHandoff({ code: data.code, waLink: data.waLink, alertsUntil: data.alertsUntil });
  };

  const until = handoff
    ? new Date(handoff.alertsUntil).toLocaleDateString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: 'numeric', month: 'short' })
    : '';

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : close())}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        {handoff ? (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl">Send it on WhatsApp</DialogTitle>
              <DialogDescription>
                {complexName} · Step 2 of 2
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm">
              Send us the message WhatsApp opens with. That is where we reply.
            </p>
            <Button asChild className="w-full" size="lg">
              <a href={handoff.waLink} target="_blank" rel="noreferrer">
                <MessageCircle className="h-4 w-4 mr-2" aria-hidden="true" />
                Open WhatsApp
              </a>
            </Button>
            <p className="text-sm text-muted-foreground">
              A person on our team checks with the agents who hold units at {complexName} and replies
              there within 24 hours of your message. Until {until} we will also tell you when a new
              listing there fits. Reply STOP any time.
            </p>
            <p className="text-xs text-muted-foreground">
              Your code is <span className="font-mono font-medium text-foreground">{handoff.code}</span> - it works for a week.
            </p>
            <Button variant="ghost" className="w-full" onClick={close}>Done</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl">Request availability</DialogTitle>
              <DialogDescription>
                {complexName} · Step 1 of 2
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="movein">Move-in date</Label>
                  <Input id="movein" type="date" min={hcmcToday()} value={moveIn} onChange={(e) => setMoveIn(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Lease</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {LEASES.map((m) => (
                      <Button key={m} type="button" variant={lease === m ? 'default' : 'outline'} onClick={() => setLease(m)}>
                        {m === 24 ? '24+' : m}m
                      </Button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Bedrooms</Label>
                <div className="grid grid-cols-4 gap-2">
                  {BEDROOMS.map((b) => (
                    <Button key={b} type="button" variant={bedrooms === b ? 'default' : 'outline'} onClick={() => setBedrooms(b)}>
                      {b === 4 ? '4+' : b}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="budget">Most you would pay a month</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="budget"
                    inputMode="decimal"
                    placeholder="e.g. 25"
                    value={budgetMillions}
                    onChange={(e) => setBudgetMillions(e.target.value.replace(/[^0-9.]/g, ''))}
                  />
                  <span className="text-sm text-muted-foreground whitespace-nowrap">million ₫</span>
                </div>
                {budgetVnd !== null && (
                  <p className={`text-xs ${budgetValid ? 'text-muted-foreground' : 'text-destructive'}`}>
                    {budgetValid
                      ? `Up to ${vnd(budgetVnd)} a month (about ${usd(budgetVnd)})`
                      : 'Enter an amount between 3 and 500 million.'}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <Label htmlFor="pets" className="cursor-pointer">Bringing a pet?</Label>
                <Switch id="pets" checked={hasPets} onCheckedChange={setHasPets} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Anything specific? (optional)</Label>
                <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="High floor, river view, furnished…" rows={2} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="name">Your name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button className="w-full" size="lg" onClick={submit} disabled={!canSubmit || submitting}>
                {submitting
                  ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
                  : <MessageCircle className="h-4 w-4 mr-2" aria-hidden="true" />}
                Continue on WhatsApp
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                A person replies on WhatsApp within 24 hours. Any country's number works.
              </p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
