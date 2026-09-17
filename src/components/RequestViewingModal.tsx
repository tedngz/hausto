// One way to ask for a viewing (CLAUDE.md invariant 8).
//
// Built as a phone screen that happens to fit on a desktop, not the reverse:
// a fixed header, one scrolling column of numbered steps, and a footer that
// stays put so the action is never a scroll away. The three questions are
// always in the same order - which place, when, where to reach you - so the
// modal reads as a form rather than a dashboard.
//
// **One place per request.** The domain still accepts up to five in one
// request - `MAX_ITEMS` is unchanged, and the agent's re-request path makes
// multi-item requests from a renter's WhatsApp reply - but the renter-facing
// form asks for one. Choosing several places and several time windows in one
// modal is two multi-selects stacked, and the second one is the one that
// actually needs the room.
//
// So the list is a single choice over the renter's matches. One exception, and
// it is correctness rather than preference: a listing seeded by the card that
// opened this modal appears even when it is not among their matches. It is
// what the renter asked to view, and a form must not quietly request something
// it never showed them.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Check, ImageOff, Loader2, Sun, Sunrise, Sunset } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useMatches } from '@/hooks/useMatches';
import { useViewingQuota } from '@/hooks/useViewingQuota';
import { useRenterIdentity } from '@/hooks/useRenterIdentity';
import { useShortlist } from '@/hooks/useShortlist';
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

interface Submitted { ref: string; waLink: string }

interface Choice {
  id: string;
  title: string;
  location: string | null;
  imageUrl: string | null;
  selected: boolean;
  /** True for a listing that came from the card, not from their matches. */
  pinned: boolean;
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
  const shortlist = useShortlist();
  const { quota } = useViewingQuota();
  const { renterMatches } = useMatches();
  const { identity } = useRenterIdentity();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [picked, setPicked] = useState<AvailabilityWindow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const [touched, setTouched] = useState({ name: false, phone: false });

  // The card that opened this is the choice, replacing anything left over from
  // a previous visit - the shortlist lives in localStorage, so without the
  // clear a renter could open a listing page and find a different flat
  // selected.
  useEffect(() => {
    if (!open || !seed) return;
    if (shortlist.has(seed.listingId) && shortlist.entries.length === 1) return;
    shortlist.clear();
    shortlist.toggle({
      listingId: seed.listingId, title: seed.title, imageUrl: seed.imageUrl ?? null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, seed?.listingId]);

  useEffect(() => {
    if (!identity) return;
    setName(prev => (touched.name || prev ? prev : identity.name));
    setPhone(prev => (touched.phone || prev ? prev : identity.phone));
  }, [identity, touched.name, touched.phone]);

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

  /**
   * The renter's matches, plus the seeded listing if it is not one of them.
   *
   * **External only.** The viewing flow requests against `external_properties`
   * and `screenCandidates` refuses anything else on submit, so offering an
   * internal match would mean picking a place, filling in the form, and being
   * told no.
   *
   * **No price.** `properties.price` is the raw column carrying USD for
   * housingsgn rows (SPEC §0) - rendering it would tell a renter a $730 flat
   * costs 730 ₫. The card they came from showed the price.
   */
  const choices = useMemo<Choice[]>(() => {
    type Match = {
      property_type?: string;
      properties?: { id?: string; title?: string; location?: string; images?: string[] | null } | null;
    };
    const matches = ((renterMatches ?? []) as Match[])
      .filter(m => m.property_type === 'external')
      .map(m => m.properties)
      .filter((p): p is NonNullable<Match['properties']> & { id: string; title: string } =>
        !!p?.id && !!p?.title);

    const matched: Choice[] = matches.map(p => ({
      id: p.id,
      title: p.title,
      location: p.location ?? null,
      imageUrl: p.images?.[0] ?? null,
      selected: shortlist.has(p.id),
      pinned: false,
    }));

    // Anything in the request that is not a match. Normally just the listing
    // whose card opened this. Shown, because a request must not contain
    // something invisible.
    const extras: Choice[] = shortlist.entries
      .filter(e => !matches.some(p => p.id === e.listingId))
      .map(e => ({
        id: e.listingId,
        title: e.title,
        location: null,
        imageUrl: e.imageUrl ?? null,
        selected: true,
        pinned: true,
      }));

    return [...extras, ...matched];
  }, [renterMatches, shortlist]);

  const count = shortlist.entries.length;
  const credits = quota?.remaining ?? 0;
  const shortOnCredits = !!quota && credits < count;

  /**
   * Pick one. The shortlist is cleared first, so choosing a second place
   * replaces the first rather than adding to it - the functional updates chain,
   * so `toggle` sees the emptied list.
   *
   * Tapping the chosen one again does nothing. Deselecting to nothing is a
   * state with no way forward, and the renter's next move from there is to pick
   * a different place anyway.
   */
  const chooseOnly = (c: Choice) => {
    if (c.selected) return;
    shortlist.clear();
    const r = shortlist.toggle({ listingId: c.id, title: c.title, imageUrl: c.imageUrl });
    if (!r.ok) toast.error(r.error ?? 'Could not select that place.');
  };

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
    setError(null);
    if (!toE164(phone)) {
      setError('Enter a Vietnamese mobile number, e.g. 0901 234 567.');
      return;
    }
    setBusy(true);
    const { data, error: err } = await supabase.functions.invoke('viewing-request-create', {
      body: {
        phone, displayName: name,
        listingIds: shortlist.entries.map(e => e.listingId),
        availability: picked,
      },
    });
    setBusy(false);
    if (err) { setError('Something went wrong on our side. Try again in a moment.'); return; }
    const payload = data as Submitted & { error?: string; message?: string };
    if (payload?.error) { setError(payload.message ?? payload.error); return; }
    setSubmitted(payload);
    shortlist.clear();
  };

  const close = () => {
    onOpenChange(false);
    if (submitted) { setSubmitted(null); setPicked([]); }
  };

  const canSubmit = !busy && count > 0 && picked.length > 0 && !shortOnCredits;

  return (
    <Dialog open={open} onOpenChange={o => (o ? onOpenChange(true) : close())}>
      {/* Full height on a phone with the footer pinned, a normal dialog above
          that. The submit button being a scroll away was the worst of the old
          layout on mobile. */}
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-full max-w-lg flex-col gap-0 p-0 sm:h-auto sm:max-h-[90vh] sm:rounded-lg">
        {submitted ? (
          <div className="space-y-4 p-6">
            <DialogHeader>
              <DialogTitle>Request {submitted.ref} is in</DialogTitle>
              <DialogDescription>
                One last step - open WhatsApp so we can reach you with the times.
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              We are contacting each agent now. You will hear from us on WhatsApp with
              the times that are actually free, usually within a day.
            </p>
            <Button asChild className="w-full">
              <a href={submitted.waLink} target="_blank" rel="noreferrer">Open WhatsApp</a>
            </Button>
            <Button variant="ghost" className="w-full" onClick={close}>Done</Button>
          </div>
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
              {/* ── 1. Places ────────────────────────────────────────── */}
              <Step
                n={1}
                title="Which place?"
                hint="One place per request, and one viewing request from your balance."
              >
                {choices.length === 0 ? (
                  <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                    No matches yet. Match a few places and they will show up here.
                  </p>
                ) : (
                  <ul role="radiogroup" aria-label="Which place" className="space-y-1.5">
                    {choices.map(c => (
                      <li key={c.id}>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={c.selected}
                          onClick={() => chooseOnly(c)}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-md border p-2 text-left transition-colors',
                            c.selected
                              ? 'border-primary bg-primary/5'
                              : 'hover:bg-muted/50',
                          )}
                        >
                          <span
                            className={cn(
                              'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                              c.selected
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-muted-foreground/40',
                            )}
                          >
                            {c.selected && <Check className="h-2.5 w-2.5" />}
                          </span>
                          {c.imageUrl
                            ? <img src={c.imageUrl} alt="" className="h-11 w-14 shrink-0 rounded object-cover" />
                            : <span className="flex h-11 w-14 shrink-0 items-center justify-center rounded bg-muted">
                                <ImageOff className="h-4 w-4 text-muted-foreground" />
                              </span>}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm">{c.title}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {c.pinned ? 'The place you opened this from' : c.location ?? 'From your matches'}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Step>

              <Separator />

              {/* ── 2. When ──────────────────────────────────────────── */}
              <Step
                n={2}
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

              <Separator />

              {/* ── 3. You ───────────────────────────────────────────── */}
              <Step
                n={3}
                title="Where do we reach you?"
                hint={
                  identity && (identity.name || identity.phone) && !touched.name && !touched.phone
                    ? 'Using the details on your account - edit either if you would rather we used something else.'
                    : undefined
                }
              >
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
            </div>

            {/* ── Footer: always reachable ───────────────────────────── */}
            <div className="shrink-0 space-y-2 border-t bg-background p-4 sm:p-6 sm:pt-4">
              {shortOnCredits ? (
                <p className="text-sm text-amber-700">
                  A request uses one viewing request and you have {credits}. Top up to
                  carry on.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {picked.length} of {MAX_WINDOWS} time window{picked.length === 1 ? '' : 's'}
                  {quota ? ` · uses 1 of your ${credits} viewing requests` : ''}
                </p>
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button className="w-full" disabled={!canSubmit} onClick={submit}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {count === 0
                  ? 'Pick a place'
                  : picked.length === 0
                    ? 'Pick a time'
                    : 'Request viewing'}
              </Button>
              <p className="text-center text-[11px] text-muted-foreground">
                Nothing is arranged yet. We confirm with each agent first.
              </p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
