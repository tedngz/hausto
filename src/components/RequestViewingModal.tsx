// One way to ask for a viewing (CLAUDE.md invariant 8).
//
// Two design calls worth knowing about, because both replaced something that
// looked reasonable:
//
// **One list, not two.** There used to be a "Places" list of what you had
// picked and a separate "From your matches" list of what you could add. Same
// job, twice, and the second one said "Nothing else matched yet" precisely
// when the first was full - which reads as an error rather than as "you have
// everything". Now there is a single list: everything you could request, with
// the chosen ones marked.
//
// **A day strip, not a month grid.** The window is MIN_LEAD_DAYS to
// MAX_DAYS_AHEAD - thirteen days. A month view spent two thirds of its cells
// on disabled dates, offered navigation to months where nothing is selectable,
// and highlighted today, which is never bookable, in a style that reads as
// selected. The strip shows the days you can actually pick and nothing else.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Check, ImageOff, Loader2, Sun, Sunrise, Sunset, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useMatches } from '@/hooks/useMatches';
import { useViewingQuota } from '@/hooks/useViewingQuota';
import { useRenterIdentity } from '@/hooks/useRenterIdentity';
import { useShortlist, MAX_SHORTLIST } from '@/hooks/useShortlist';
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
  MORNING: 'Morning',
  AFTERNOON: 'Afternoon',
  EVENING: 'Evening',
};

const PART_ICON: Record<DayPart, typeof Sun> = {
  MORNING: Sunrise,
  AFTERNOON: Sun,
  EVENING: Sunset,
};

export interface RequestSeed {
  listingId: string;
  title: string;
  imageUrl?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The listing whose card was clicked, added to the request on open. */
  seed?: RequestSeed | null;
}

interface Submitted {
  ref: string;
  waLink: string;
}

/** A place the renter can put in the request. */
interface Choice {
  id: string;
  title: string;
  location: string | null;
  imageUrl: string | null;
  selected: boolean;
}

/** "2026-09-19" -> { weekday: "Sat", day: "19", month: "Sept" } */
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

  // Seeding on open rather than on mount: the modal is rendered by whichever
  // card holds it, and a card nobody clicked must not add its listing.
  useEffect(() => {
    if (!open || !seed) return;
    if (shortlist.has(seed.listingId)) return;
    const r = shortlist.toggle({
      listingId: seed.listingId, title: seed.title, imageUrl: seed.imageUrl ?? null,
    });
    if (!r.ok) toast.error(r.error ?? 'That request is already full.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, seed?.listingId]);

  // Prefill fills only a field the renter has left alone: the identity query
  // can resolve after they start typing and must not overwrite them mid-word.
  useEffect(() => {
    if (!identity) return;
    setName(prev => (touched.name || prev ? prev : identity.name));
    setPhone(prev => (touched.phone || prev ? prev : identity.phone));
  }, [identity, touched.name, touched.phone]);

  const today = hcmcDate(new Date());
  const earliest = addDays(today, MIN_LEAD_DAYS);

  /** Every day that can actually be requested. Thirteen of them. */
  const days = useMemo(() => {
    const out: string[] = [];
    for (let i = MIN_LEAD_DAYS; i <= MAX_DAYS_AHEAD; i++) out.push(addDays(today, i));
    return out;
  }, [today]);

  const chosenDates = useMemo(
    () => [...new Set(picked.map(w => w.date))].sort(),
    [picked],
  );

  /**
   * One list: what is in the request, plus the matches that could be.
   *
   * **External only.** The viewing flow requests against `external_properties`
   * and `screenCandidates` rejects anything else on submit, so offering an
   * internal match would mean the renter picks it, fills in the form, and is
   * refused.
   *
   * **No price.** `properties.price` is the raw column carrying USD for
   * housingsgn rows (SPEC §0), so rendering it would tell a renter a $730 flat
   * costs 730 ₫. The canonical `price_vnd` is a per-listing read and a dozen of
   * those to decorate a picker is not worth it; the card they came from showed
   * the price.
   *
   * Chosen places come first, and a seeded listing that is not among their
   * matches still appears - it is in the request, so it has to be visible and
   * removable.
   */
  const choices = useMemo<Choice[]>(() => {
    type Match = {
      property_type?: string;
      properties?: { id?: string; title?: string; location?: string; images?: string[] | null } | null;
    };
    const fromMatches = ((renterMatches ?? []) as Match[])
      .filter(m => m.property_type === 'external')
      .map(m => m.properties)
      .filter((p): p is NonNullable<Match['properties']> & { id: string; title: string } =>
        !!p?.id && !!p?.title);

    const seen = new Set<string>();
    const chosen: Choice[] = shortlist.entries.map(e => {
      seen.add(e.listingId);
      const m = fromMatches.find(p => p.id === e.listingId);
      return {
        id: e.listingId,
        title: e.title,
        location: m?.location ?? null,
        imageUrl: e.imageUrl ?? m?.images?.[0] ?? null,
        selected: true,
      };
    });

    const rest: Choice[] = fromMatches
      .filter(p => !seen.has(p.id))
      .map(p => ({
        id: p.id,
        title: p.title,
        location: p.location ?? null,
        imageUrl: p.images?.[0] ?? null,
        selected: false,
      }));

    return [...chosen, ...rest];
  }, [renterMatches, shortlist.entries]);

  const count = shortlist.entries.length;
  const credits = quota?.remaining ?? 0;
  const shortOnCredits = !!quota && credits < count;
  const full = count >= MAX_SHORTLIST;

  const toggleChoice = (c: Choice) => {
    if (!c.selected && full) {
      toast.error(`${MAX_SHORTLIST} places is as many as fit in one day.`);
      return;
    }
    const r = shortlist.toggle({ listingId: c.id, title: c.title, imageUrl: c.imageUrl });
    if (!r.ok) toast.error(r.error ?? 'That request is full.');
  };

  const toggleDay = (date: string) => {
    setPicked(prev => {
      if (prev.some(w => w.date === date)) return prev.filter(w => w.date !== date);
      if (prev.length >= MAX_WINDOWS) {
        toast.error(`Pick up to ${MAX_WINDOWS} time windows.`);
        return prev;
      }
      // A date carrying no part means nothing to an operator, so choosing a day
      // opts into the morning and lets the renter widen or move it.
      return [...prev, { date, part: 'MORNING' }];
    });
  };

  const toggleWindow = (date: string, part: DayPart) => {
    setPicked(prev => {
      const exists = prev.some(w => w.date === date && w.part === part);
      if (exists) {
        const left = prev.filter(w => !(w.date === date && w.part === part));
        // Removing the last part of a day removes the day: an operator cannot
        // act on "Saturday, no times".
        return left;
      }
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
        phone,
        displayName: name,
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
      <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-3xl overflow-y-auto p-4 sm:p-6">
        {submitted ? (
          <>
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
          </>
        ) : !user ? (
          <>
            <DialogHeader>
              <DialogTitle>Sign in to request viewings</DialogTitle>
              <DialogDescription>
                Your requests and viewing requests balance live on your account.
              </DialogDescription>
            </DialogHeader>
            <Button asChild className="w-full"><Link to="/auth">Sign in</Link></Button>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Request viewings</DialogTitle>
              <DialogDescription>
                We contact each agent for you and come back with the times that are
                free. You never deal with them, and they never get your number.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-6 sm:grid-cols-2">
              {/* ── Which places ───────────────────────────────────────── */}
              <section className="min-w-0">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-medium">Which places?</h3>
                  <span className="text-xs text-muted-foreground">
                    {count} of {MAX_SHORTLIST} selected
                  </span>
                </div>

                {choices.length === 0 ? (
                  <p className="rounded border border-dashed p-4 text-sm text-muted-foreground">
                    Nothing to request yet. Match a few places first and they will
                    show up here.
                  </p>
                ) : (
                  <ScrollArea className="h-[19rem] rounded-md border">
                    <ul className="divide-y">
                      {choices.map(c => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => toggleChoice(c)}
                            aria-pressed={c.selected}
                            disabled={!c.selected && full}
                            className={cn(
                              'flex w-full items-center gap-3 p-2 text-left transition-colors',
                              c.selected ? 'bg-primary/5' : 'hover:bg-muted/60',
                              !c.selected && full && 'cursor-not-allowed opacity-50',
                            )}
                          >
                            {c.imageUrl
                              ? <img src={c.imageUrl} alt="" className="h-11 w-14 shrink-0 rounded object-cover" />
                              : <div className="flex h-11 w-14 shrink-0 items-center justify-center rounded bg-muted">
                                  <ImageOff className="h-4 w-4 text-muted-foreground" />
                                </div>}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm">{c.title}</span>
                              {c.location && (
                                <span className="block truncate text-xs text-muted-foreground">
                                  {c.location}
                                </span>
                              )}
                            </span>
                            <span
                              className={cn(
                                'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                                c.selected
                                  ? 'border-primary bg-primary text-primary-foreground'
                                  : 'border-muted-foreground/40',
                              )}
                            >
                              {c.selected && <Check className="h-3 w-3" />}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </ScrollArea>
                )}

                <p className="mt-2 text-xs text-muted-foreground">
                  {full
                    ? `That is ${MAX_SHORTLIST} - as many as fit in one day.`
                    : count === 0
                      ? 'Pick at least one.'
                      : `You can add up to ${MAX_SHORTLIST - count} more for the same visit.`}
                </p>
              </section>

              {/* ── When ───────────────────────────────────────────────── */}
              <section className="min-w-0">
                <h3 className="mb-1 text-sm font-medium">When are you free?</h3>
                <p className="mb-2 text-xs text-muted-foreground">
                  We need two days to reach the agents, so the soonest is{' '}
                  {prettyDate(earliest)}.
                </p>

                {/* Only the days that can be requested. A month grid spent two
                    thirds of itself on dates nobody could choose. */}
                <ScrollArea className="rounded-md border">
                  <div className="grid grid-cols-4 gap-1.5 p-2 sm:grid-cols-5">
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
                            on
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'hover:bg-muted',
                          )}
                        >
                          <span className="text-[10px] uppercase opacity-80">{p.weekday}</span>
                          <span className="text-sm font-semibold leading-tight">{p.day}</span>
                          <span className="text-[10px] opacity-80">{p.month}</span>
                        </button>
                      );
                    })}
                  </div>
                </ScrollArea>

                {chosenDates.length === 0 ? (
                  <p className="mt-3 rounded border border-dashed p-3 text-sm text-muted-foreground">
                    Pick a day above, then the times that suit.
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {chosenDates.map(date => (
                      <li key={date} className="rounded-md border p-2">
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{prettyDate(date)}</span>
                          <Button
                            type="button" size="icon" variant="ghost" className="h-7 w-7"
                            aria-label={`Remove ${prettyDate(date)}`}
                            onClick={() => setPicked(prev => prev.filter(w => w.date !== date))}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
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
                                  on
                                    ? 'border-primary bg-primary text-primary-foreground'
                                    : 'hover:bg-muted',
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

                <p className="mt-2 text-xs text-muted-foreground">
                  {picked.length} of {MAX_WINDOWS} time windows
                </p>
              </section>
            </div>

            {/* ── Who ──────────────────────────────────────────────────── */}
            {identity && (identity.name || identity.phone) && !touched.name && !touched.phone && (
              <p className="text-xs text-muted-foreground">
                Using the details on your account - edit either if you would rather we
                used something else.
              </p>
            )}
            <section className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="rv-name">Your name</Label>
                <Input
                  id="rv-name" value={name} placeholder="Minh"
                  onChange={e => { setTouched(t => ({ ...t, name: true })); setName(e.target.value); }}
                />
              </div>
              <div>
                <Label htmlFor="rv-phone">WhatsApp number</Label>
                <Input
                  id="rv-phone" value={phone}
                  onChange={e => { setTouched(t => ({ ...t, phone: true })); setPhone(e.target.value); }}
                  placeholder="0901 234 567" inputMode="tel"
                />
              </div>
            </section>

            {quota && !shortOnCredits && count > 0 && (
              <p className="text-xs text-muted-foreground">
                Uses {count} of your {credits} viewing request{credits === 1 ? '' : 's'} - one per place.
              </p>
            )}
            {shortOnCredits && (
              <p className="text-sm text-amber-700">
                This covers {count} place{count === 1 ? '' : 's'} and needs {count} viewing
                request{count === 1 ? '' : 's'} - you have {credits}. Remove a place, or top up.
              </p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button className="w-full" disabled={!canSubmit} onClick={submit}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Request {count || ''} viewing{count === 1 ? '' : 's'}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Nothing is arranged yet. We confirm with each agent first.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
