// One way to ask for a viewing (CLAUDE.md invariant 8).
//
// Built as a phone screen that happens to fit on a desktop, not the reverse:
// a fixed header, one scrolling column of numbered steps, and a footer that
// stays put so the action is never a scroll away. Two questions, always in the
// same order - when, and where to reach you - and nothing else: no counters,
// nothing the renter has to read past to find the button.
//
// **The place is the one the renter opened this from**, so the modal does not
// show it back to them. Someone who wants three seen taps "Request viewing" on
// three cards - or selects them in Browse, which opens this with all of them.
//
// **And those three become one plan.** While the renter has a request whose
// agents are still being asked, a new place joins it (intake.ts
// `pickJoinable`): it takes that request's times, its WhatsApp thread, and a
// seat in its one itinerary message. Three separate requests would be three
// itineraries, three billed messages and no clash warning between viewings
// that were never in the same plan.
//
// **One request at a time** (the pricing rework, SPEC §1, §9). Each is real
// operator hours, so once a request is past joining - its plan assembled or
// sent - a new one waits until that plan is locked in or lapses. The modal
// says so before the renter picks anything.
//
// **Arranging viewings is the Pass's** (owner's decision, 2026-10-07, SPEC
// §9), with one free place per WhatsApp number. The modal applies the
// server's own rule (`requestGate`) to the places it was opened for and shows
// the Pass instead of a form the server would refuse. **The price is said
// here**: a renter who met a price only after requesting may report the
// message, and reports lower the WhatsApp number's quality rating.
//
// **For one place whose ad lists the agent's number, it opens on a choice**
// (ViewingChoice, SPEC §6): we arrange it, or call the agent yourself. The
// card still carries one button; the choice is behind it. Several places, or
// an ad with no number, go straight to the steps below.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { RefundPromise } from '@/components/RefundPromise';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Loader2, Sun, Sunrise, Sunset } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { offerInquiryFor } from '@/lib/offerInquiry';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePass } from '@/hooks/usePass';
import { useRenterIdentity } from '@/hooks/useRenterIdentity';
import { useHasAgentNumber } from '@/hooks/useHasAgentNumber';
import { ViewingChoice } from '@/components/ViewingChoice';
import {
  DAY_PARTS,
  MAX_DAYS_AHEAD,
  MAX_ITEMS,
  MAX_LAPSED_WITHOUT_PASS,
  MIN_LEAD_DAYS,
  requestGate,
  requestGateMessage,
  addDays,
  hcmcDate,
  toRenterE164,
  RENTER_PHONE_HINT,
  type AvailabilityWindow,
  type DayPart,
} from '../../supabase/functions/_shared/viewing/intake.ts';
import { PASS_DAYS, PASS_PRICE_USD } from '../../supabase/functions/_shared/viewing/lock-in.ts';

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
  /** The place the modal was opened from. */
  seed?: RequestSeed | null;
  /** Or the places, when opened from a selection. At most five - one day of viewings. */
  seeds?: RequestSeed[];
}

interface Submitted { ref: string; waLink: string; joined?: boolean; placeCount?: number }

/** What `viewing-request-open` says about the request a new place would join. */
interface OpenRequest {
  ref: string;
  availability: AvailabilityWindow[];
  listingIds: string[];
}

interface OpenState {
  open: OpenRequest | null;
  /** The request a new one waits behind, when it cannot be joined. */
  blocking: { ref: string; listingIds: string[] } | null;
  /** Two plans lapsed without being locked in, and no Pass. */
  passRequired: boolean;
  hasPass: boolean;
  /** requestGate's inputs the modal cannot know. Absent from an older function. */
  lapsedPlans?: number;
  freeViewingAvailable?: boolean | null;
}

/** What it costs, said on every request screen (SPEC §9). */
export function lockInPriceLine(hasPass: boolean): string {
  return hasPass
    ? 'Your Pass covers every viewing we arrange.'
    : `This is your free viewing: once the agent confirms, lock it in at no cost. Having us arrange more takes the Pass ($${PASS_PRICE_USD} for ${PASS_DAYS} days).`;
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

export function RequestViewingModal({ open, onOpenChange, seed, seeds }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { pass, purchasePass } = usePass();
  const { identity } = useRenterIdentity();
  const places = useMemo(
    () => (seeds?.length ? seeds : seed ? [seed] : []).slice(0, MAX_ITEMS),
    [seed, seeds],
  );

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [picked, setPicked] = useState<AvailabilityWindow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const [touched, setTouched] = useState({ name: false, phone: false });
  // Past the choice: the renter picked "We arrange it". Every opening starts
  // at the choice again.
  const [arranging, setArranging] = useState(false);
  useEffect(() => {
    if (!open) setArranging(false);
  }, [open]);

  const single = places.length === 1 ? places[0] : null;
  const { data: agentInfo, isLoading: agentLoading } = useHasAgentNumber(single?.listingId, open && !!single);
  const beforeChoice = !!single && !submitted && !arranging;
  const checkingChoice = beforeChoice && agentLoading;
  const choosing = beforeChoice && agentInfo?.hasNumber === true;

  useEffect(() => {
    if (!identity) return;
    setName(prev => (touched.name || prev ? prev : identity.name));
    setPhone(prev => (touched.phone || prev ? prev : identity.phone));
  }, [identity, touched.name, touched.phone]);

  // Asked every time the modal opens, never cached across opens: the request
  // it names may have moved on to its itinerary in the meantime. The server
  // decides again at submit either way - this is what the renter is shown.
  const { data: openState, isLoading: openLoading } = useQuery<OpenState | null>({
    queryKey: ['viewing-open-request', user?.id],
    enabled: open && !!user,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    queryFn: async () => {
      const { data, error: err } = await supabase.functions.invoke('viewing-request-open', { body: {} });
      // A failed lookup falls back to asking for times; submit decides.
      if (err) return null;
      return (data as OpenState) ?? null;
    },
  });

  const join = openState?.open ?? null;
  // Past joining - its plan assembled or sent - so a new request waits.
  const waitingOn = !join ? openState?.blocking ?? null : null;
  const hasPass = !!openState?.hasPass || !!pass?.active;
  const fresh = places.filter(p => !join?.listingIds.includes(p.listingId));
  const alreadyIn = !!join && places.length > 0 && fresh.length === 0;
  // The server's own rule (requestGate), with the places this was opened for:
  // past the one free place, arranging viewings is the Pass's. Not asked while
  // a request blocks, or for places already in the open one.
  const gate = openState && !waitingOn && !alreadyIn
    ? requestGate({
      hasPass,
      placeCount: join ? fresh.length : places.length,
      joining: !!join,
      freeViewingAvailable: openState.freeViewingAvailable ?? null,
      lapsedPlans: openState.lapsedPlans ?? (openState.passRequired ? MAX_LAPSED_WITHOUT_PASS : 0),
    })
    : null;
  const passGate = gate && 'reason' in gate ? gate.reason : null;
  const passRequired = !!passGate;

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
    if (places.length === 0) return;
    setError(null);
    if (!join && !toRenterE164(phone)) {
      setError(RENTER_PHONE_HINT);
      return;
    }
    setBusy(true);
    const listingIds = (join ? fresh : places).map(p => p.listingId);
    const { data, error: err } = await supabase.functions.invoke('viewing-request-create', {
      body: {
        ...(join
          ? { listingIds, joinRef: join.ref }
          : { phone, displayName: name, listingIds, availability: picked }),
        // An offer link carries the availability request it came from; with
        // several places, the first that has one.
        inquiryId: places.map(p => offerInquiryFor(p.listingId)).find(Boolean) ?? null,
      },
    });
    setBusy(false);

    // A non-2xx arrives as `err` with the body still readable on its context.
    // The refusals are ones the renter can act on, so they are read out rather
    // than flattened into "something went wrong".
    let payload = data as (Submitted & { error?: string; message?: string }) | null;
    if (err) {
      const ctx = (err as { context?: Response }).context;
      payload = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null;
      if (!payload?.error) { setError('Something went wrong on our side. Try again in a moment.'); return; }
    }
    if (payload?.error) {
      setError(payload.message ?? payload.error);
      // The request moved on between opening and submitting. Ask again: the
      // modal then shows what is true now.
      if (payload.error === 'join_closed' || payload.error === 'one_open_request' || payload.error === 'pass_required') {
        queryClient.invalidateQueries({ queryKey: ['viewing-open-request'] });
      }
      return;
    }
    setSubmitted(payload);
    queryClient.invalidateQueries({ queryKey: ['my-viewing-requests'] });
  };

  const close = () => {
    onOpenChange(false);
    setError(null);
    if (submitted) { setSubmitted(null); setPicked([]); }
  };

  const canSubmit = !busy && places.length > 0 && !alreadyIn && !waitingOn && !passRequired && !openLoading
    && (join ? true : picked.length > 0);

  const priceLine = lockInPriceLine(hasPass);

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
                  One plan, one message: we fit {fresh.length > 1 ? 'these places' : 'this place'} in with the
                  {submitted.placeCount && submitted.placeCount - fresh.length > 1 ? ' others' : ' other one'} and
                  send you every time together on WhatsApp.
                </DialogDescription>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                We are contacting the {fresh.length > 1 ? 'agents' : 'agent'} now, at the same times you gave before.
              </p>
              <p className="text-xs text-muted-foreground">{priceLine}</p>
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
                We are contacting the {places.length > 1 ? 'agents' : 'agent'} now. You will hear from us on
                WhatsApp with the times that are actually free, usually within a day, and a link to lock
                them in.
              </p>
              <p className="text-xs text-muted-foreground">{priceLine}</p>
              <Button asChild className="w-full">
                <a href={submitted.waLink} target="_blank" rel="noreferrer">Open WhatsApp</a>
              </Button>
              <Button variant="ghost" className="w-full" onClick={close}>Done</Button>
            </div>
          )
        ) : checkingChoice ? (
          // Usually instant: the listing page and the preview have asked already.
          <div className="flex flex-1 items-center justify-center p-10">
            <DialogTitle className="sr-only">Request a viewing</DialogTitle>
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
          </div>
        ) : choosing && single ? (
          <ViewingChoice
            listingId={single.listingId}
            title={single.title}
            hasPass={hasPass}
            sourceName={agentInfo?.sourceName}
            onArrange={() => setArranging(true)}
          />
        ) : !user ? (
          <div className="space-y-4 p-6">
            <DialogHeader>
              <DialogTitle>Sign in to request a viewing</DialogTitle>
              <DialogDescription>
                Your first viewing is on us. Your requests and plans live on your account.
              </DialogDescription>
            </DialogHeader>
            <Button asChild className="w-full"><Link to="/auth">Sign in</Link></Button>
          </div>
        ) : (
          <>
            <DialogHeader className="shrink-0 space-y-1 border-b p-4 text-left sm:p-6 sm:pb-4">
              <DialogTitle>{places.length > 1 ? `Request ${places.length} viewings` : 'Request a viewing'}</DialogTitle>
              <DialogDescription className="text-xs sm:text-sm">
                We contact the {places.length > 1 ? 'agents' : 'agent'} for you and come back with the times
                that are free. They never get your number.
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
              {/* No "which place" step: the modal opens from the listing, so
                  the renter is already looking at it. */}
              {openLoading ? (
                <Step n={1} title="When are you free?">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </Step>
              ) : waitingOn ? (
                <div className="space-y-2 rounded-md border bg-muted/40 p-4 text-sm">
                  <p className="font-medium">We are still working on {waitingOn.ref}</p>
                  <p className="text-muted-foreground">
                    One request at a time: once you lock in its plan, or it lapses, you can request
                    more places. Its plan comes on WhatsApp with a link to lock it in.
                  </p>
                </div>
              ) : passGate ? (
                <div className="space-y-3 rounded-md border bg-muted/40 p-4 text-sm">
                  <p className="font-medium">Having us arrange this takes the Pass</p>
                  <p className="text-muted-foreground">
                    {requestGateMessage(passGate, PASS_PRICE_USD, PASS_DAYS)} It covers every viewing we
                    arrange for {PASS_DAYS} days, one-off.
                  </p>
                  <Button size="sm" onClick={() => void purchasePass()}>Get the Pass - ${PASS_PRICE_USD}</Button>
                  {/* Here more than anywhere: since #171 this is where a renter
                      pays before any agent has answered. */}
                  <RefundPromise />
                </div>
              ) : join ? (
                <Step
                  n={1}
                  title="When"
                  hint={alreadyIn
                    ? `${places.length > 1 ? 'These places are' : 'This place is'} already in your request ${join.ref}. We will be in touch on WhatsApp.`
                    : `Adding ${fresh.length > 1 ? 'these' : 'this'} to your request ${join.ref}, at the times you already gave. We fit it into the same plan and send one message with every time.`}
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
                </Step>
              ) : (
                <Step
                  n={1}
                  title="When are you free?"
                  hint={`We need two days to reach the agents, so the soonest is ${prettyDate(earliest)}.`}
                >
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
              {!join && !waitingOn && !passRequired && !openLoading && (
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
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Not a Vietnamese number? Start with the country code, like +44.
                        </p>
                      </div>
                    </div>
                  </Step>
                </>
              )}
            </div>

            {/* ── Footer: always reachable ───────────────────────────── */}
            <div className="shrink-0 space-y-2 border-t bg-background p-4 sm:p-6 sm:pt-4">
              {/* The Pass box says what it costs when it shows. */}
              {!passGate && <p className="text-xs text-muted-foreground">{priceLine}</p>}
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button className="w-full" disabled={!canSubmit} onClick={submit}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {alreadyIn
                  ? 'Already requested'
                  : waitingOn
                    ? `Waiting on ${waitingOn.ref}`
                    : join
                      ? `Add to request ${join.ref}`
                      : picked.length === 0
                        ? 'Pick a time'
                        : places.length > 1 ? `Request ${places.length} viewings` : 'Request viewing'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
