import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { useViewingQuota } from '@/hooks/useViewingQuota';
import { SubscriptionModal } from '@/components/SubscriptionModal';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { toast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle2, ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  complexId: string;
  complexName: string;
}

export function ConciergeCaptureModal({ open, onOpenChange, complexId, complexName }: Props) {
  const { user } = useAuth();
  const { subscribed } = useSubscription();
  const { quota } = useViewingQuota();
  const navigate = useNavigate();
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  // Step 1
  const [moveIn, setMoveIn] = useState('');
  const [lease, setLease] = useState(12);
  // Step 2
  const [bedrooms, setBedrooms] = useState(2);
  const [budget, setBudget] = useState<[number, number]>([1500, 3000]);
  const [hasPets, setHasPets] = useState(false);
  // Step 3
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');

  const reset = () => {
    setStep(1); setDone(false); setMoveIn(''); setLease(12);
    setBedrooms(2); setBudget([1500, 3000]); setHasPets(false);
    setName(''); setEmail(''); setPhone(''); setNotes('');
    setPrefilled(false);
  };

  // Logged-in renters shouldn't retype what Hausto already knows: prefill the
  // contact step from their profile the first time the modal opens.
  useEffect(() => {
    if (!open || !user || prefilled) return;
    let cancelled = false;
    (async () => {
      const { data: profile } = await supabase
        .from('profiles')
        .select('name, email, phone')
        .eq('id', user.id)
        .maybeSingle();
      if (cancelled) return;
      setName(prev => prev || profile?.name || user.user_metadata?.name || '');
      setEmail(prev => prev || profile?.email || user.email || '');
      setPhone(prev => prev || profile?.phone || user.user_metadata?.phone || '');
      setPrefilled(true);
    })();
    return () => { cancelled = true; };
  }, [open, user, prefilled]);

  const close = () => { onOpenChange(false); setTimeout(reset, 300); };

  // Signed-out visitors get the trial pitch too - a new account starts with one.
  const trialPitch = user ? !!quota?.trialAvailable : true;

  const canNext1 = moveIn && lease > 0;
  const canNext2 = bedrooms > 0 && budget[0] >= 0 && budget[1] > budget[0];
  const canSubmit = name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const submit = async () => {
    setSubmitting(true);
    // Only admins can SELECT from complex_inquiries, so we can't read the id back
    // after inserting - mint it here instead and hand it to the notifier.
    const inquiryId = crypto.randomUUID();
    const { error } = await supabase.from('complex_inquiries').insert({
      id: inquiryId,
      complex_id: complexId,
      user_id: user?.id ?? null,
      full_name: name.trim(),
      email: email.trim(),
      phone: phone.trim() || null,
      target_move_in_date: moveIn,
      lease_duration_months: lease,
      budget_usd_min: budget[0],
      budget_usd_max: budget[1],
      bedrooms_needed: bedrooms,
      has_pets: hasPets,
      additional_notes: notes.trim() || null,
    });
    if (error) {
      setSubmitting(false);
      toast({ title: 'Could not submit', description: error.message, variant: 'destructive' });
      return;
    }

    // Alert the concierge team + confirm to the renter. The request is already
    // saved, so a mail failure must not look like a failed submission.
    try {
      const { error: notifyError } = await supabase.functions.invoke('notify-complex-inquiry', {
        body: { inquiryId },
      });
      if (notifyError) throw notifyError;
    } catch (e) {
      console.error('[concierge] notification failed', e);
    }

    setSubmitting(false);
    setDone(true);
  };

  return (
    <>
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : close())}>
      <DialogContent className="max-w-lg">
        {done ? (
          <div className="py-8 text-center space-y-4">
            <CheckCircle2 className="h-14 w-14 mx-auto text-primary" aria-hidden="true" />
            <DialogTitle className="text-2xl font-serif">You're on the list</DialogTitle>
            <DialogDescription className="text-base">
              Our concierge will reach out within 24 hours with vetted availability at <strong>{complexName}</strong>.
            </DialogDescription>
            {!subscribed && (
              <div className="rounded-lg border bg-secondary/40 p-4 text-left space-y-2">
                <p className="text-sm font-medium">Want to see units in person?</p>
                <p className="text-sm text-muted-foreground">
                  {trialPitch
                    ? "Your first viewing coordination is free - Hausto's Fast-Track team books the visit for you."
                    : "Hausto's Fast-Track team books the visits for you. Premium includes 3 coordinated viewings a cycle."}
                </p>
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => (trialPitch ? navigate('/browse') : setShowUpgrade(true))}
                >
                  {trialPitch ? 'Book my free viewing' : 'Go Premium to schedule viewings'}
                </Button>
              </div>
            )}
            <Button variant={subscribed ? 'default' : 'ghost'} onClick={close} className="mt-2">Close</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl">Check active availability</DialogTitle>
              <DialogDescription>
                {complexName} · Step {step} of 3
              </DialogDescription>
            </DialogHeader>

            {/* Progress */}
            <div className="flex gap-1.5 mb-2">
              {[1, 2, 3].map((s) => (
                <div key={s} className={`h-1 flex-1 rounded-full ${s <= step ? 'bg-primary' : 'bg-muted'}`} />
              ))}
            </div>

            {step === 1 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="movein">Target move-in date</Label>
                  <Input id="movein" type="date" value={moveIn} onChange={(e) => setMoveIn(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Lease duration</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {[6, 12, 24].map((m) => (
                      <Button key={m} variant={lease === m ? 'default' : 'outline'} onClick={() => setLease(m)}>
                        {m} months{m === 24 ? '+' : ''}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-5">
                <div className="space-y-2">
                  <Label>Bedrooms needed</Label>
                  <div className="grid grid-cols-5 gap-2">
                    {[1, 2, 3, 4, 5].map((b) => (
                      <Button key={b} variant={bedrooms === b ? 'default' : 'outline'} onClick={() => setBedrooms(b)}>
                        {b === 5 ? '5+' : b}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Monthly budget (USD)</Label>
                    <span className="text-sm font-medium">${budget[0].toLocaleString()} – ${budget[1].toLocaleString()}</span>
                  </div>
                  <Slider
                    min={500} max={10000} step={100}
                    value={budget}
                    onValueChange={(v) => setBudget([v[0], v[1]] as [number, number])}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <Label htmlFor="pets" className="cursor-pointer">Traveling with pets?</Label>
                    <p className="text-xs text-muted-foreground">We'll filter pet-friendly stock.</p>
                  </div>
                  <Switch id="pets" checked={hasPets} onCheckedChange={setHasPets} />
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                {user && prefilled && (name || email) && (
                  <p className="text-xs text-muted-foreground rounded-md bg-secondary/40 px-3 py-2">
                    We've filled this in from your Hausto profile — just confirm and adjust if needed.
                  </p>
                )}
                <div className="space-y-2">
                  <Label htmlFor="name">Full name *</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email *</Label>
                  <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone (optional)</Label>
                  <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 0100" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">Anything specific?</Label>
                  <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="High floor, river view, furnished…" rows={3} />
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-4">
              {step > 1 ? (
                <Button variant="ghost" onClick={() => setStep(step - 1)}>
                  <ArrowLeft className="h-4 w-4 mr-1" aria-hidden="true" /> Back
                </Button>
              ) : <div />}
              {step < 3 && (
                <Button
                  onClick={() => setStep(step + 1)}
                  disabled={step === 1 ? !canNext1 : !canNext2}
                >
                  Next <ArrowRight className="h-4 w-4 ml-1" aria-hidden="true" />
                </Button>
              )}
              {step === 3 && (
                <Button onClick={submit} disabled={!canSubmit || submitting}>
                  {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />}
                  Request availability
                </Button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
    <SubscriptionModal isOpen={showUpgrade} onClose={() => setShowUpgrade(false)} />
    </>
  );
}
