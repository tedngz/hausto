// One way to ask for a viewing (CLAUDE.md invariant 8).
//
// Built as a phone screen that happens to fit on a desktop, not the reverse:
// a fixed header, one scrolling column of numbered steps, and a footer that
// stays put so the action is never a scroll away. Two questions, always in the
// same order - when, and where to reach you - and nothing else: no counters,
// no reassurance lines, nothing the renter has to read past to find the button.
//
// **The place is the one the renter opened this from**, so the modal does not
// show it back to them. It used to be a single choice over their matches,
// which mostly offered a way to request a flat they were not looking at.
// Someone who wants three seen taps "Request viewing" on three cards.
//
// **And those three become one plan.** While the renter has a request whose
// agents are still being asked, a new place joins it (intake.ts
// `pickJoinable`): it takes that request's times, its WhatsApp thread, and a
// seat in its one itinerary message. Three separate requests would be three
// itineraries, three billed messages and no clash warning between viewings
// that were never in the same plan. The renter can still choose different
// times, which makes it a request of its own.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Loader2, Sun, Sunrise, Sunset } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useViewingQuota } from '@/hooks/useViewingQuota';
import { useRenterIdentity } from '@/hooks/useRenterIdentity';
import {
  DAY_PARTS,
  MAX_DAYS_AHEAD,
  MIN_LEAD_DAYS,
  addDays,
  hcmcDate,
  toE164,
  type AvailabilityWindow,
  type DayPart,
} from '../../supabase/functions/_shared/viewing/intake.ts';

const MAX_WINDOWS = 6;

const PART_LABEL: Record<DayPart, string> = {
  MORNING: 'Morning', AFTERNOON: 'Afternoon', EVENING: 'Evening',
};
const PART_ICON: Record<DayPart, typeof Sun> = {
  MORNING: Sunrise, AFTERNOON: Sun, EVENING: Sunset,
};

export interface RequestSeed {
  listingId: string;
  title: string;
  imageUrl?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seed?: RequestSeed | null;
}

interface Submitted { ref: string; waLink: string; joined?: boolean; placeCount?: number }

/** What `viewing-request-open` says about the request a new place would join. */
interface OpenRequest {
  ref: string;
  availability: AvailabilityWindow[];
  listingIds: string[];
}

function partsOf(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  return {
    weekday: d.toLocaleDateString('en-GB', { weekday: 'short' }),
    day: d.toLocaleDateString('en-GB', { day: 'numeric' }),
    month: d.toLocaleDateString('en-GB', { month: 'short' }),
  };
}
const prettyDate = (iso: string) => {
  const p = partsOf(iso);
  return `${p.weekday} ${p.day} ${p.month}`;
};

/** A numbered step, so the modal reads in an order. */
function Step({ n, title, hint, children }: {
  n: number; title: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
          {n}
        </span>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {hint && <p className="pl-7 text-xs text-muted-foreground">{hint}</p>}
      <div className="pl-7">{children}</div>
    </section>
  );
}

export function RequestViewingModal({ open, onOpenChange, seed }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { quota } = useViewingQuota();
  const { identity } = useRenterIdentity();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [picked, setPicked] = useState<AvailabilityWindow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const [touched, setTouched] = useState({ name: false, phone: false });
  /** The renter chose their own times over joining their open request. */
  const [separate, setSeparate] = useState(false);

  useEffect(() => {
    if (!identity) return;
    setName(prev => (touched.name || prev ? prev : identity.name));
    setPhone(prev => (touched.phone || prev ? prev : identity.phone));
  }, [identity, touched.name, touched.phone]);

  // Asked every time the modal opens, never cached across opens: the request
  // it names may have moved on to its itinerary in the meantime. The server
  // decides again at submit either way - this is what the renter is shown.
  const { data: openRequest, isLoading: openLoading } = useQuery<OpenRequest | null>({
    queryKey: ['viewing-open-request', user?.id],
    enabled: open && !!user,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    queryFn: async () => {
      const { data, error: err } = await supabase.functions.invoke('viewing-request-open', { body: {} });
      // A failed lookup falls back to asking for times, which is always safe.
      if (err) return null;
      return ((data as { open?: OpenRequest | null })?.open) ?? null;
    },
  });

  const join = openRequest && !separate ? openRequest : null;
  const alreadyIn = !!seed && !!openRequest?.listingIds.includes(seed.listingId);

  const today = hcmcDate(new Date());
  const earliest = addDays(today, MIN_LEAD_DAYS);

  const days = useMemo(() => {
    const out: string[] = [];
    for (let i = MIN_LEAD_DAYS; i <= MAX_DAYS_AHEAD; i++) out.push(addDays(today, i));
    return out;
  }, [today]);

  const chosenDates = useMemo(
    () => [...new Set(picked.map(w => w.date))].sort(), [picked],
  );

  /** The joined request's times still ahead, grouped by day, for display. */
  const joinDays = useMemo(() => {
    if (!join) return [];
    const byDate = new Map<string, DayPart[]>();
    for (const w of join.availability) {
      if (w.date < today) continue;
      byDate.set(w.date, [...(byDate.get(w.date) ?? []), w.part]);
    }
    return [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  }, [join, today]);

  const credits = quota?.remaining ?? 0;
  const shortOnCredits = !!quota && credits < 1;

  const toggleDay = (date: string) => {
    setPicked(prev => {
      if (prev.some(w => w.date === date)) return prev.filter(w => w.date !== date);
      if (prev.length >= MAX_WINDOWS) {
        toast.error(`Pick up to ${MAX_WINDOWS} time windows.`);
        return prev;
      }
      return [...prev, { date, part: 'MORNING' }];
    });
  };

  const toggleWindow = (date: string, part: DayPart) => {
    setPicked(prev => {
      const exists = prev.some(w => w.date === date && w.part === part);
      // Removing the last part of a day removes the day: an operator cannot act
      // on "Saturday, no times".
      if (exists) return prev.filter(w => !(w.date === date && w.part === part));
      if (prev.length >= MAX_WINDOWS) {
        toast.error(`Pick up to ${MAX_WINDOWS} time windows.`);
        return prev;
      }
      return [...prev, { date, part }];
    });
  };

  const submit = async () => {
    if (!seed) return;
    setError(null);
    if (!join && !toE164(phone)) {
      setError('Enter a Vietnamese mobile number, e.g. 0901 234 567.');
      return;
    }
    setBusy(true);
    const { data, error: err } = await supabase.functions.invoke('viewing-request-create', {
      body: join
        ? { listingIds: [seed.listingId], joinRef: join.ref }
        : { phone, displayName: name, listingIds: [seed.listingId], availability: picked },
    });
    setBusy(false);

    // A non-2xx arrives as `err` with the body still readable on its context.
    // The join refusals are 409s the renter can act on, so they are read out
    // rather than flattened into "something went wrong".
    let payload = data as (Submitted & { error?: string; message?: string }) | null;
    if (err) {
      const ctx = (err as { context?: Response }).context;
      payload = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null;
      if (!payload?.error) { setError('Something went wrong on our side. Try again in a moment.'); return; }
    }
    if (payload?.error) {
      setError(payload.message ?? payload.error);
      // The request moved on to its itinerary between opening and submitting.
      // Ask again; with nothing open, the modal becomes an ordinary request.
      if (payload.error === 'join_closed') {
        queryClient.invalidateQueries({ queryKey: ['viewing-open-request'] });
      }
      return;
    }
    setSubmitted(payload);
    queryClient.invalidateQueries({ queryKey: ['viewing-quota'] });
    queryClient.invalidateQueries({ queryKey: ['my-viewing-requests'] });
  };

  const close = () => {
    onOpenChange(false);
    setError(null);
    setSeparate(false);
    if (submitted) { setSubmitted(null); setPicked([]); }
  };

  const canSubmit = !busy && !!seed && !alreadyIn && !shortOnCredits && !openLoading
    && (join ? true : picked.length > 0);

  return (
    <Dialog open={open} onOpenChange={o => (o ? onOpenChange(true) : close())}>
      {/* Full height on a phone with the footer pinned, a normal dialog above
          that. The submit button being a scroll away was the worst of the old
          layout on mobile. */}
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-full max-w-lg flex-col gap-0 p-0 sm:h-auto sm:max-h-[90vh] sm:rounded-lg">
        {submitted ? (
          submitted.joined ? (
            <div className="space-y-4 p-6">
              <DialogHeader>
                <DialogTitle>Added to request {submitted.ref}</DialogTitle>
                <DialogDescription>
                  One plan, one message: we fit this place in with the
                  {submitted.placeCount && submitted.placeCount > 2 ? ' others' : ' other one'} and
                  send you every time together on WhatsApp.
                </DialogDescription>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                We are contacting this agent now, at the same times you gave before.
              </p>
              <Button className="w-full" onClick={close}>Done</Button>
              <p className="text-center text-xs text-muted-foreground">
                Not messaged us about {submitted.ref} yet?{' '}
                <a href={submitted.waLink} target="_blank" rel="noreferrer" className="underline">
                  Open WhatsApp
                </a>
              </p>
            </div>
          ) : (
            <div className="space-y-4 p-6">
              <DialogHeader>
                <DialogTitle>Request {submitted.ref} is in</DialogTitle>
                <DialogDescription>
                  One last step - open WhatsApp so we can reach you with the times.
                </DialogDescription>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                We are contacting the agent now. You will hear from us on WhatsApp with
                the times that are actually free, usually within a day. Want to see more
                places? Request them the same way and we fit them into this plan.
              </p>
              <Button asChild className="w-full">
                <a href={submitted.waLink} target="_blank" rel="noreferrer">Open WhatsApp</a>
              </Button>
              <Button variant="ghost" className="w-full" onClick={close}>Done</Button>
            </div>
          )
        ) : !user ? (
          <div className="space-y-4 p-6">
            <DialogHeader>
              <DialogTitle>Sign in to request a viewing</DialogTitle>
              <DialogDescription>
                Your requests and viewing requests balance live on your account.
              </DialogDescription>
            </DialogHeader>
            <Button asChild className="w-full"><Link to="/auth">Sign in</Link></Button>
          </div>
        ) : (
          <>
            <DialogHeader className="shrink-0 space-y-1 border-b p-4 text-left sm:p-6 sm:pb-4">
              <DialogTitle>Request a viewing</DialogTitle>
              <DialogDescription className="text-xs sm:text-sm">
                We contact the agent for you and come back with the times that are
                free. They never get your number.
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
              {/* ── 1. When ──────────────────────────────────────────── */}
              {/* No "which place" step: the modal opens from the listing, so
                  the renter is already looking at it. */}
              {openLoading ? (
                <Step n={1} title="When are you free?">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </Step>
              ) : join ? (
                <Step
                  n={1}
                  title="When"
                  hint={alreadyIn
                    ? `This place is already in your request ${join.ref}. We will be in touch on WhatsApp.`
                    : `Adding this to your request ${join.ref}, at the times you already gave. We fit it into the same plan and send one message with every time.`}
                >
                  <ul className="space-y-1.5">
                    {joinDays.map(([date, parts]) => (
                      <li key={date} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                        <span className="font-medium">{prettyDate(date)}</span>
                        <span className="text-muted-foreground">
                          {parts.map(p => PART_LABEL[p]).join(', ')}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {!alreadyIn && (
                    <button
                      type="button"
                      onClick={() => { setSeparate(true); setError(null); }}
                      className="mt-2 text-xs text-muted-foreground underline"
                    >
                      Different times? Make it a separate request
                    </button>
                  )}
                </Step>
              ) : (
                <Step
                  n={1}
                  title="When are you free?"
                  hint={`We need two days to reach the agents, so the soonest is ${prettyDate(earliest)}.`}
                >
                  {openRequest && (
                    <p className="mb-2 text-xs text-muted-foreground">
                      This will be a separate request from {openRequest.ref}.{' '}
                      <button
                        type="button"
                        onClick={() => { setSeparate(false); setError(null); }}
                        className="underline"
                      >
                        Add it to {openRequest.ref} instead
                      </button>
                    </p>
                  )}
                  <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
                    {days.map(date => {
                      const p = partsOf(date);
                      const on = chosenDates.includes(date);
                      return (
                        <button
                          key={date}
                          type="button"
                          onClick={() => toggleDay(date)}
                          aria-pressed={on}
                          className={cn(
                            'flex flex-col items-center rounded-md border px-1 py-1.5 text-center transition-colors',
                            on ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted',
                          )}
                        >
                          <span className="text-[10px] uppercase opacity-80">{p.weekday}</span>
                          <span className="text-sm font-semibold leading-tight">{p.day}</span>
                          <span className="text-[10px] opacity-80">{p.month}</span>
                        </button>
                      );
                    })}
                  </div>

                  {chosenDates.length > 0 && (
                    <ul className="mt-3 space-y-2">
                      {chosenDates.map(date => (
                        <li key={date} className="rounded-md border p-2">
                          <div className="mb-1.5 text-sm font-medium">{prettyDate(date)}</div>
                          <div className="grid grid-cols-3 gap-1.5">
                            {DAY_PARTS.map(part => {
                              const on = picked.some(w => w.date === date && w.part === part);
                              const Icon = PART_ICON[part];
                              return (
                                <button
                                  key={part}
                                  type="button"
                                  aria-pressed={on}
                                  onClick={() => toggleWindow(date, part)}
                                  className={cn(
                                    'flex flex-col items-center gap-0.5 rounded-md border px-1 py-1.5 text-[11px] transition-colors',
                                    on ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted',
                                  )}
                                >
                                  <Icon className="h-3.5 w-3.5" />
                                  {PART_LABEL[part]}
                                </button>
                              );
                            })}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Step>
              )}

              {/* ── 2. You ───────────────────────────────────────────── */}
              {/* Not asked when joining: the answer goes to the WhatsApp thread
                  the open request already has. */}
              {!join && !openLoading && (
                <>
                  <Separator />
                  <Step n={2} title="Where do we reach you?">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="rv-name" className="text-xs">Your name</Label>
                        <Input
                          id="rv-name" value={name} placeholder="Minh"
                          onChange={e => { setTouched(t => ({ ...t, name: true })); setName(e.target.value); }}
                        />
                      </div>
                      <div>
                        <Label htmlFor="rv-phone" className="text-xs">WhatsApp number</Label>
                        <Input
                          id="rv-phone" value={phone} placeholder="0901 234 567" inputMode="tel"
                          onChange={e => { setTouched(t => ({ ...t, phone: true })); setPhone(e.target.value); }}
                        />
                      </div>
                    </div>
                  </Step>
                </>
              )}
            </div>

            {/* ── Footer: always reachable ───────────────────────────── */}
            <div className="shrink-0 space-y-2 border-t bg-background p-4 sm:p-6 sm:pt-4">
              {/* Only when it explains a disabled button. */}
              {shortOnCredits && (
                <p className="text-sm text-amber-700">
                  A request uses one viewing request and you have none left. Top up to
                  carry on.
                </p>
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button className="w-full" disabled={!canSubmit} onClick={submit}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {alreadyIn
                  ? 'Already requested'
                  : join
                    ? `Add to request ${join.ref}`
                    : picked.length === 0
                      ? 'Pick a time'
                      : 'Request viewing'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
