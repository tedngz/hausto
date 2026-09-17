// One way to ask for a viewing (CLAUDE.md invariant 8).
//
// Replaces two buttons that sat side by side on every card - "Shortlist" and
// "Book viewing" - which asked the renter to care about a distinction that was
// ours, not theirs: one built a list, the other opened a scheduler, and both
// ended in somebody visiting a flat.
//
// Three rules it exists to hold:
//
// 1. **An itinerary is one day.** Up to five places (MAX_ITEMS), enforced here
//    and again in `validateShortlist` on the server. One is a perfectly good
//    request; the matches picker is here to make adding a second easy, not to
//    make the first conditional on it.
//
// 2. **Today and tomorrow are never bookable** (MIN_LEAD_DAYS, invariant 7).
//    The calendar disables them rather than letting the server refuse after
//    the form is filled in.
//
// 3. **One credit per property, not per request.** A fourth place costs the
//    same as requesting it alone, because it is the same hour of somebody's
//    time either way.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Check, ImageOff, Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useMatches } from '@/hooks/useMatches';
import { useViewingQuota } from '@/hooks/useViewingQuota';
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

/** A match the renter can actually request. */
interface Offerable {
  id: string;
  title: string;
  location: string | null;
  imageUrl: string | null;
}

/** Calendar days are local dates; never let a timezone decide the boundary. */
function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "2026-09-19" -> "Sat 19 Sept", in the renter's city. */
function prettyDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

export function RequestViewingModal({ open, onOpenChange, seed }: Props) {
  const { user } = useAuth();
  const shortlist = useShortlist();
  const { quota } = useViewingQuota();
  const { renterMatches } = useMatches();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [picked, setPicked] = useState<AvailabilityWindow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<Submitted | null>(null);

  // Seeding on open rather than on mount: the modal is rendered by whichever
  // card holds it, and a card nobody clicked must not add its listing.
  useEffect(() => {
    if (!open || !seed) return;
    if (shortlist.has(seed.listingId)) return;
    const r = shortlist.toggle({
      listingId: seed.listingId, title: seed.title, imageUrl: seed.imageUrl ?? null,
    });
    if (!r.ok) toast.error(r.error ?? 'That request is already full.');
    // Only when the dialog opens. shortlist changes on every add and would
    // otherwise re-run this and fight the renter removing the seeded card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, seed?.listingId]);

  const today = hcmcDate(new Date());
  const earliest = addDays(today, MIN_LEAD_DAYS);
  const latest = addDays(today, MAX_DAYS_AHEAD);

  const chosenDates = useMemo(
    () => [...new Set(picked.map(w => w.date))].sort(),
    [picked],
  );

  const selectedIds = useMemo(
    () => new Set(shortlist.entries.map(e => e.listingId)),
    [shortlist.entries],
  );

  /**
   * Matches the renter can actually request.
   *
   * **External only.** The viewing flow requests against `external_properties`;
   * an internal listing has its own path, and `screenCandidates` rejects one on
   * submit. Offering it here would mean the renter picks a place, fills in the
   * form, and is told no - which is a worse failure than never offering it.
   *
   * No price. `properties.price` is the raw column, which carries USD for
   * housingsgn rows and only its magnitude says which (SPEC §0) - rendering it
   * would tell a renter a $730 flat costs 730 ₫. The canonical `price_vnd` is
   * a per-listing read, and twelve of those to decorate a picker is not worth
   * it. The card they came from showed the price; this is a reminder of which
   * place, not a listing page.
   */
  const offerable = useMemo<Offerable[]>(() => {
    type Match = {
      property_type?: string;
      properties?: { id?: string; title?: string; location?: string; images?: string[] | null } | null;
    };
    return ((renterMatches ?? []) as Match[])
      .filter(m => m.property_type === 'external')
      .map(m => m.properties)
      .filter((p): p is NonNullable<Match['properties']> & { id: string; title: string } =>
        !!p?.id && !!p?.title && !selectedIds.has(p.id))
      .map(p => ({
        id: p.id,
        title: p.title,
        location: p.location ?? null,
        imageUrl: p.images?.[0] ?? null,
      }));
  }, [renterMatches, selectedIds]);

  const count = shortlist.entries.length;
  const credits = quota?.remaining ?? 0;
  const shortOnCredits = !!quota && credits < count;
  const full = count >= MAX_SHORTLIST;

  const toggleWindow = (date: string, part: DayPart) => {
    setPicked(prev => {
      const exists = prev.some(w => w.date === date && w.part === part);
      if (exists) return prev.filter(w => !(w.date === date && w.part === part));
      if (prev.length >= MAX_WINDOWS) {
        toast.error(`Pick up to ${MAX_WINDOWS} time windows.`);
        return prev;
      }
      return [...prev, { date, part }];
    });
  };

  const addDate = (d?: Date) => {
    if (!d) return;
    const iso = toIsoDate(d);
    if (chosenDates.includes(iso)) {
      setPicked(prev => prev.filter(w => w.date !== iso));
      return;
    }
    if (picked.length >= MAX_WINDOWS) {
      toast.error(`Pick up to ${MAX_WINDOWS} time windows.`);
      return;
    }
    // A date with no part chosen means nothing to an operator, so picking a day
    // opts into the morning and lets the renter widen or move it.
    setPicked(prev => [...prev, { date: iso, part: 'MORNING' }]);
  };

  const addMatch = (p: Offerable) => {
    const r = shortlist.toggle({ listingId: p.id, title: p.title, imageUrl: p.imageUrl });
    if (!r.ok) toast.error(r.error ?? 'That request is full.');
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
    // Reset only after a completed request: a renter who closed by accident
    // mid-form should find their dates still there.
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

            {/* Two columns from sm up, stacked on a phone. The calendar is the
                widest thing here and drove the layout: side by side it fits
                without shrinking, stacked it gets the full width. */}
            <div className="grid gap-6 sm:grid-cols-2">
              {/* ── Places ─────────────────────────────────────────────── */}
              <section className="min-w-0">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-medium">Places</h3>
                  <span className="text-xs text-muted-foreground">
                    {count} of {MAX_SHORTLIST}
                  </span>
                </div>

                {count === 0 ? (
                  <p className="rounded border border-dashed p-3 text-sm text-muted-foreground">
                    Pick at least one place below.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {shortlist.entries.map(e => (
                      <li key={e.listingId} className="flex items-center gap-2 rounded border p-2">
                        {e.imageUrl
                          ? <img src={e.imageUrl} alt="" className="h-10 w-14 shrink-0 rounded object-cover" />
                          : <div className="flex h-10 w-14 shrink-0 items-center justify-center rounded bg-muted">
                              <ImageOff className="h-4 w-4 text-muted-foreground" />
                            </div>}
                        <span className="min-w-0 flex-1 truncate text-sm">{e.title}</span>
                        <Button
                          type="button" size="icon" variant="ghost"
                          aria-label={`Remove ${e.title}`}
                          onClick={() => shortlist.remove(e.listingId)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}

                {count > 0 && !full && (
                  // An invitation, not a requirement. Seeing several in one trip
                  // is better for the renter and it is the operator's round
                  // either way - but a request for one is a real request.
                  <p className="mt-2 text-xs text-muted-foreground">
                    You can add up to {MAX_SHORTLIST - count} more for the same visit.
                  </p>
                )}

                {/* ── From your matches ───────────────────────────────── */}
                <div className="mt-4">
                  <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    From your matches
                  </h4>
                  {offerable.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {count > 0
                        ? 'Nothing else matched yet.'
                        : 'No matches yet - browse and match a few places first.'}
                    </p>
                  ) : (
                    <ScrollArea className="h-48 rounded border">
                      <ul className="divide-y">
                        {offerable.map(p => (
                          <li key={p.id} className="flex items-center gap-2 p-2">
                            {p.imageUrl
                              ? <img src={p.imageUrl} alt="" className="h-10 w-14 shrink-0 rounded object-cover" />
                              : <div className="flex h-10 w-14 shrink-0 items-center justify-center rounded bg-muted">
                                  <ImageOff className="h-4 w-4 text-muted-foreground" />
                                </div>}
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm">{p.title}</div>
                              {p.location && (
                                <div className="truncate text-xs text-muted-foreground">{p.location}</div>
                              )}
                            </div>
                            <Button
                              type="button" size="sm" variant="outline"
                              disabled={full}
                              onClick={() => addMatch(p)}
                            >
                              <Plus className="mr-1 h-3 w-3" /> Add
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </ScrollArea>
                  )}
                  {full && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      That is {MAX_SHORTLIST} - as many as fit in one day.
                    </p>
                  )}
                </div>
              </section>

              {/* ── When ───────────────────────────────────────────────── */}
              <section className="min-w-0">
                <h3 className="mb-1 text-sm font-medium">When are you free?</h3>
                <p className="mb-2 text-xs text-muted-foreground">
                  Tap dates, then the times that suit. We need two days to reach the
                  agents, so the soonest is {prettyDate(earliest)}.
                </p>

                {/* The calendar sizes to its column instead of a fixed width,
                    which is what made it overflow on a phone. */}
                <div className="flex justify-center">
                  <Calendar
                    mode="multiple"
                    selected={chosenDates.map(d => new Date(`${d}T00:00:00`))}
                    onDayClick={addDate}
                    disabled={{
                      before: new Date(`${earliest}T00:00:00`),
                      after: new Date(`${latest}T00:00:00`),
                    }}
                    className="w-full max-w-[19rem] rounded-md border p-2"
                  />
                </div>

                {chosenDates.length === 0 ? (
                  <p className="mt-3 rounded border border-dashed p-3 text-sm text-muted-foreground">
                    No dates yet. Tap one above.
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {chosenDates.map(date => (
                      <li key={date} className="rounded border p-2">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{prettyDate(date)}</span>
                          <Button
                            type="button" size="icon" variant="ghost"
                            aria-label={`Remove ${prettyDate(date)}`}
                            onClick={() => setPicked(prev => prev.filter(w => w.date !== date))}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {DAY_PARTS.map(part => {
                            const on = picked.some(w => w.date === date && w.part === part);
                            return (
                              <Button
                                key={part} type="button" size="sm"
                                variant={on ? 'default' : 'outline'}
                                aria-pressed={on}
                                onClick={() => toggleWindow(date, part)}
                              >
                                {on && <Check className="mr-1 h-3 w-3" />}
                                {PART_LABEL[part]}
                              </Button>
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
            <section className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="rv-name">Your name</Label>
                <Input id="rv-name" value={name} onChange={e => setName(e.target.value)} placeholder="Minh" />
              </div>
              <div>
                <Label htmlFor="rv-phone">WhatsApp number</Label>
                <Input
                  id="rv-phone" value={phone} onChange={e => setPhone(e.target.value)}
                  placeholder="0901 234 567" inputMode="tel"
                />
              </div>
            </section>

            {quota && !shortOnCredits && count > 0 && (
              <p className="text-xs text-muted-foreground">
                Uses {count} of your {credits} viewing request{credits === 1 ? '' : 's'}.
                <Badge variant="secondary" className="ml-2">one per place</Badge>
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
