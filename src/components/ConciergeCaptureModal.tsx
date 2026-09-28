import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useViewingQuota } from '@/hooks/useViewingQuota';
import { usePass } from '@/hooks/usePass';
import { SubscriptionModal } from '@/components/SubscriptionModal';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle2, ArrowLeft, ArrowRight, Loader2, Mail, MessageCircle } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  complexId: string;
  complexName: string;
}

type Channel = 'WHATSAPP' | 'EMAIL';
type Stage = 'needs' | 'reply' | 'whatsapp' | 'email-done';

interface WhatsAppHandoff { code: string; waLink: string; alertsUntil: string }

const LEASES = [6, 12, 24] as const;
const BEDROOMS = [1, 2, 3, 4] as const;

const vnd = (dong: number) => `${dong.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ₫`;
// A rough guide for renters who think in dollars - the listings they have seen
// elsewhere often are. Never stored.
const usd = (dong: number) => `US$${(Math.round(dong / 25_000 / 50) * 50).toLocaleString('en-US')}`;

/** Today in Ho Chi Minh City, `YYYY-MM-DD`. */
const hcmcToday = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * "Check availability at Empire City" (SPEC §11).
 *
 * A person on our team asks the agents who hold units in the building and
 * replies within 24 hours. Two steps - what you need, where we reply - and on
 * WhatsApp a last one: send us the message WhatsApp opens with. That message
 * is the opt-in and proves the number is theirs, so the form never asks for a
 * phone number, and the concierge's 24 hours start when it arrives.
 */
export function ConciergeCaptureModal({ open, onOpenChange, complexId, complexName }: Props) {
  const { user } = useAuth();
  const { pass } = usePass();
  const { quota } = useViewingQuota();
  const navigate = useNavigate();
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [stage, setStage] = useState<Stage>('needs');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);
  const [handoff, setHandoff] = useState<WhatsAppHandoff | null>(null);

  // What they need
  const [moveIn, setMoveIn] = useState('');
  const [lease, setLease] = useState<number>(12);
  const [bedrooms, setBedrooms] = useState<number>(2);
  const [budgetMillions, setBudgetMillions] = useState('');
  const [hasPets, setHasPets] = useState(false);
  const [notes, setNotes] = useState('');
  // Where we reply
  const [name, setName] = useState('');
  const [channel, setChannel] = useState<Channel>('WHATSAPP');
  const [email, setEmail] = useState('');

  const reset = () => {
    setStage('needs'); setError(null); setHandoff(null); setSubmitting(false);
    setMoveIn(''); setLease(12); setBedrooms(2); setBudgetMillions(''); setHasPets(false); setNotes('');
    setName(''); setChannel('WHATSAPP'); setEmail('');
    setPrefilled(false);
  };

  // Logged-in renters shouldn't retype what Hausto already knows.
  useEffect(() => {
    if (!open || !user || prefilled) return;
    let cancelled = false;
    (async () => {
      const { data: profile } = await supabase
        .from('profiles')
        .select('name, email')
        .eq('id', user.id)
        .maybeSingle();
      if (cancelled) return;
      setName(prev => prev || profile?.name || user.user_metadata?.name || '');
      setEmail(prev => prev || profile?.email || user.email || '');
      setPrefilled(true);
    })();
    return () => { cancelled = true; };
  }, [open, user, prefilled]);

  const close = () => { onOpenChange(false); setTimeout(reset, 300); };

  // Signed-out visitors get the trial pitch too - a new account starts with one.
  const trialPitch = user ? !!quota?.trialAvailable : true;

  const budgetVnd = budgetMillions.trim() ? Math.round(Number(budgetMillions) * 1_000_000) : null;
  const budgetValid = budgetVnd !== null && Number.isFinite(budgetVnd) && budgetVnd >= 3_000_000 && budgetVnd <= 500_000_000;
  const canContinue = !!moveIn && moveIn >= hcmcToday() && budgetValid;
  const canSubmit = !!name.trim() && (channel === 'WHATSAPP' || EMAIL.test(email.trim()));

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
        channel,
        email: email.trim() || null,
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
    if (data.channel === 'WHATSAPP') {
      setHandoff({ code: data.code, waLink: data.waLink, alertsUntil: data.alertsUntil });
      setStage('whatsapp');
    } else {
      setStage('email-done');
    }
  };

  const until = handoff
    ? new Date(handoff.alertsUntil).toLocaleDateString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: 'numeric', month: 'short' })
    : '';

  return (
    <>
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : close())}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        {stage === 'whatsapp' && handoff ? (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl">One last step</DialogTitle>
              <DialogDescription>
                Send us the message WhatsApp opens with. That is where we reply.
              </DialogDescription>
            </DialogHeader>
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
        ) : stage === 'email-done' ? (
          <div className="py-8 text-center space-y-4">
            <CheckCircle2 className="h-14 w-14 mx-auto text-primary" aria-hidden="true" />
            <DialogTitle className="text-2xl font-serif">Your request is in</DialogTitle>
            <DialogDescription className="text-base">
              A person on our team checks with the agents at <strong>{complexName}</strong> and emails you within 24 hours.
            </DialogDescription>
            {!pass?.active && (
              <div className="rounded-lg border bg-secondary/40 p-4 text-left space-y-2">
                <p className="text-sm font-medium">Want to see units in person?</p>
                <p className="text-sm text-muted-foreground">
                  {trialPitch
                    ? 'Your first viewing is on us - Hausto arranges the visit for you.'
                    : 'Hausto arranges the visits for you. The Pass includes 3 viewing requests.'}
                </p>
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => (trialPitch ? navigate('/browse') : setShowUpgrade(true))}
                >
                  {trialPitch ? 'Request my free viewing' : 'Get the Pass to request viewings'}
                </Button>
              </div>
            )}
            <Button variant={pass?.active ? 'default' : 'ghost'} onClick={close} className="mt-2">Close</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl">Check availability</DialogTitle>
              <DialogDescription>
                {complexName} · Step {stage === 'needs' ? 1 : 2} of 2
              </DialogDescription>
            </DialogHeader>

            <div className="flex gap-1.5 mb-1">
              {[1, 2].map((s) => (
                <div key={s} className={`h-1 flex-1 rounded-full ${s <= (stage === 'needs' ? 1 : 2) ? 'bg-primary' : 'bg-muted'}`} />
              ))}
            </div>

            {stage === 'needs' && (
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

                <Button className="w-full" onClick={() => setStage('reply')} disabled={!canContinue}>
                  Next <ArrowRight className="h-4 w-4 ml-1" aria-hidden="true" />
                </Button>
              </div>
            )}

            {stage === 'reply' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Your name</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
                </div>

                <div className="space-y-2">
                  <Label>Where should we reply?</Label>
                  <div className="grid grid-cols-1 gap-2">
                    <button
                      type="button"
                      onClick={() => setChannel('WHATSAPP')}
                      className={`rounded-lg border p-3 text-left transition ${channel === 'WHATSAPP' ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'}`}
                    >
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <MessageCircle className="h-4 w-4" aria-hidden="true" /> WhatsApp
                        <span className="text-xs font-normal text-primary">Fastest</span>
                      </span>
                      <span className="block text-xs text-muted-foreground mt-1">
                        A person replies within 24 hours, and we tell you when new listings here fit.
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setChannel('EMAIL')}
                      className={`rounded-lg border p-3 text-left transition ${channel === 'EMAIL' ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'}`}
                    >
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <Mail className="h-4 w-4" aria-hidden="true" /> Email
                      </span>
                      <span className="block text-xs text-muted-foreground mt-1">A person replies within 24 hours.</span>
                    </button>
                  </div>
                </div>

                {channel === 'EMAIL' && (
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
                  </div>
                )}

                {error && <p className="text-sm text-destructive">{error}</p>}

                <div className="flex items-center justify-between gap-2 pt-1">
                  <Button variant="ghost" onClick={() => { setError(null); setStage('needs'); }}>
                    <ArrowLeft className="h-4 w-4 mr-1" aria-hidden="true" /> Back
                  </Button>
                  <Button onClick={submit} disabled={!canSubmit || submitting}>
                    {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />}
                    {channel === 'WHATSAPP' ? 'Continue on WhatsApp' : 'Send request'}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
    <SubscriptionModal isOpen={showUpgrade} onClose={() => setShowUpgrade(false)} />
    </>
  );
}
