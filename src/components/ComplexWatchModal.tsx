import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, MessageCircle } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  complexId: string;
  complexName: string;
  /** The email concierge, for renters without WhatsApp. */
  onEmailInstead: () => void;
}

interface Created { code: string; waLink: string; expiresAt: string }

const BEDROOMS: { value: number | null; label: string }[] = [
  { value: null, label: 'Any' },
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4+' },
];

const vnd = (dong: number) => `${dong.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ₫`;

/** Today in Ho Chi Minh City, `YYYY-MM-DD`. */
const hcmcToday = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

/**
 * "Tell me when a place comes up here", on WhatsApp (SPEC §11).
 *
 * The form asks for no phone number. The renter opts in by sending us the
 * message the last step opens - that proves the number is theirs, and it is
 * the only consent a proactive WhatsApp message should rest on.
 */
export function ComplexWatchModal({ open, onOpenChange, complexId, complexName, onEmailInstead }: Props) {
  const [bedrooms, setBedrooms] = useState<number | null>(null);
  const [budgetMillions, setBudgetMillions] = useState('');
  const [moveInBy, setMoveInBy] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  const budgetVnd = budgetMillions.trim() ? Math.round(Number(budgetMillions) * 1_000_000) : null;
  const budgetValid = budgetVnd === null || (Number.isFinite(budgetVnd) && budgetVnd >= 3_000_000 && budgetVnd <= 500_000_000);

  const reset = () => {
    setBedrooms(null); setBudgetMillions(''); setMoveInBy('');
    setError(null); setCreated(null); setSubmitting(false);
  };
  const close = () => { onOpenChange(false); setTimeout(reset, 300); };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const { data, error: fnError } = await supabase.functions.invoke('complex-watch-create', {
      body: { complexId, bedrooms, budgetMaxVnd: budgetVnd, moveInBy: moveInBy || null },
    });
    setSubmitting(false);
    if (fnError || !data?.success) {
      let message = 'Could not set up the alert. Try again in a moment.';
      // supabase-js hides a non-2xx body behind `context`; the function's own
      // message says what to fix.
      try {
        const body = await (fnError as { context?: Response })?.context?.json();
        if (body?.message) message = body.message;
      } catch { /* keep the generic message */ }
      setError(message);
      return;
    }
    setCreated({ code: data.code, waLink: data.waLink, expiresAt: data.expiresAt });
  };

  const until = created
    ? new Date(created.expiresAt).toLocaleDateString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: 'numeric', month: 'short' })
    : '';

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : close())}>
      <DialogContent className="max-w-md">
        {created ? (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl">One last step</DialogTitle>
              <DialogDescription>
                Send us the message WhatsApp opens with. That turns on alerts for {complexName}.
              </DialogDescription>
            </DialogHeader>
            <Button asChild className="w-full" size="lg">
              <a href={created.waLink} target="_blank" rel="noreferrer">
                <MessageCircle className="h-4 w-4 mr-2" aria-hidden="true" />
                Open WhatsApp
              </a>
            </Button>
            <p className="text-sm text-muted-foreground">
              We check new listings at {complexName} once a week, until {until}, and message you
              when one fits. Reply STOP any time to end alerts. Your code is{' '}
              <span className="font-mono font-medium text-foreground">{created.code}</span> - it works
              for a week.
            </p>
            <Button variant="ghost" className="w-full" onClick={close}>Done</Button>
          </div>
        ) : (
          <div className="space-y-5">
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl">Get WhatsApp alerts</DialogTitle>
              <DialogDescription>
                We message you when a new place at {complexName} fits. Free, and you can stop any time.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Label>Bedrooms</Label>
              <div className="grid grid-cols-5 gap-2">
                {BEDROOMS.map((b) => (
                  <Button
                    key={b.label}
                    type="button"
                    variant={bedrooms === b.value ? 'default' : 'outline'}
                    onClick={() => setBedrooms(b.value)}
                  >
                    {b.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="watch-budget">Most you would pay a month (optional)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="watch-budget"
                  inputMode="decimal"
                  placeholder="e.g. 25"
                  value={budgetMillions}
                  onChange={(e) => setBudgetMillions(e.target.value.replace(/[^0-9.]/g, ''))}
                />
                <span className="text-sm text-muted-foreground whitespace-nowrap">million ₫</span>
              </div>
              {budgetVnd !== null && (
                <p className={`text-xs ${budgetValid ? 'text-muted-foreground' : 'text-destructive'}`}>
                  {budgetValid ? `Up to ${vnd(budgetVnd)} a month` : 'Enter an amount between 3 and 500 million.'}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="watch-movein">Moving in by (optional)</Label>
              <Input
                id="watch-movein"
                type="date"
                min={hcmcToday()}
                value={moveInBy}
                onChange={(e) => setMoveInBy(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Alerts stop two weeks after this date, or after 60 days without one.</p>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button className="w-full" size="lg" onClick={submit} disabled={submitting || !budgetValid}>
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />}
              Continue on WhatsApp
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              No WhatsApp?{' '}
              <button type="button" className="underline" onClick={() => { close(); onEmailInstead(); }}>
                Ask our concierge by email
              </button>
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
