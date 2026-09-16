// One way to ask for a viewing.
//
// This replaces two buttons that sat side by side on every card - "Shortlist"
// and "Book viewing" - which asked the renter to understand a distinction that
// was ours, not theirs: one built a list, the other opened a scheduler, and
// both ended in somebody visiting a flat. Now there is one button, and the
// thing it opens is this.
//
// Three rules it exists to hold:
//
// 1. **An itinerary is one day.** 3 to 5 places, enforced here and again in
//    `validateShortlist` on the server. Clicking from a single card seeds that
//    card and then asks for the rest, which is why the matches list is in here
//    rather than on a page the renter would have to go find.
//
// 2. **Today and tomorrow are never bookable** (MIN_LEAD_DAYS). An operator has
//    to reach every agent by hand. The calendar disables them rather than
//    letting the server refuse after the form is filled in.
//
// 3. **One credit per property, not per request.** Adding a fourth place to a
//    request costs the same as requesting it on its own, because it is the same
//    hour of somebody's time either way.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Check, Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useMatches } from '@/hooks/useMatches';
import { useViewingQuota } from '@/hooks/useViewingQuota';
import { useShortlist, MIN_SHORTLIST, MAX_SHORTLIST } from '@/hooks/useShortlist';
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
  accepted: string[];
}

/** Calendar days are local dates; never let a timezone decide the boundary. */
function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

  // Seeding on open rather than on mount: the modal is mounted by whichever
  // card rendered it, and a card that is never clicked must not silently add
  // its listing to the renter's request.
  useEffect(() => {
    if (!open || !seed) return;
    if (shortlist.has(seed.listingId)) return;
    const r = shortlist.toggle({
      listingId: seed.listingId,
      title: seed.title,
      imageUrl: seed.imageUrl ?? null,
    });
    if (!r.ok) toast.error(r.error ?? 'That request is already full.');
    // Only when the dialog opens. shortlist changes on every add and would
    // otherwise re-run this and fight the renter removing the seeded card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, seed?.listingId]);

  const today = hcmcDate(new Date());
  const earliest = addDays(today, MIN_LEAD_DAYS);
  const latest = addDays(today, MAX_DAYS_AHEAD);

  // Dates that carry at least one chosen window, in order.
  const chosenDates = useMemo(
    () => [...new Set(picked.map(w => w.date))].sort(),
    [picked],
  );

  const selectedIds = new Set(shortlist.entries.map(e => e.listingId));

  /** Matches not already in the request - the only ones worth offering. */
  const addable = useMemo(() => {
    type Match = { properties?: { id?: string; title?: string; images?: string[] } | null };
    return ((renterMatches ?? []) as Match[])
      .map(m => m.properties)
      .filter((p): p is { id: string; title: string; images?: string[] } =>
        !!p?.id && !!p?.title && !selectedIds.has(p.id))
      .slice(0, 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renterMatches, shortlist.entries]);

  const count = shortlist.entries.length;
  const enough = count >= MIN_SHORTLIST;
  // One credit per property. A request for four costs four, the same as four
  // requests for one, because it is the same four hours of a coordinator's day.
  const credits = quota?.remaining ?? 0;
  const shortOnCredits = !!quota && credits < count;

  const toggleWindow = (date: string, part: DayPart) => {
    setPicked(prev => {
      const exists = prev.some(w => w.date === date && w.part === part);
      if (exists) return prev.filter(w => !(w.date === date && w.part === part));
      if (prev.length >= MAX_WINDOWS) {
        toast.error(`Pick up to ${MAX_WINDOWS} windows.`);
        return prev;
      }
      return [...prev, { date, part }];
    });
  };

  const addDate = (d?: Date) => {
    if (!d) return;
    const iso = toIsoDate(d);
    if (chosenDates.includes(iso)) return;
    if (picked.length >= MAX_WINDOWS) {
      toast.error(`Pick up to ${MAX_WINDOWS} windows.`);
      return;
    }
    // A date with no part chosen means nothing to the operator, so picking a
    // day opts into the morning and lets the renter widen or move it.
    setPicked(prev => [...prev, { date: iso, part: 'MORNING' }]);
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
    if (submitted) {
      setSubmitted(null);
      setPicked([]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
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
                Your requests and viewing credits live on your account.
              </DialogDescription>
            </DialogHeader>
            <Button asChild className="w-full">
              <Link to="/auth">Sign in</Link>
            </Button>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Request viewings</DialogTitle>
              <DialogDescription>
                We contact each agent for you and come back with the times that are free.
                You never deal with them, and they never get your number.
              </DialogDescription>
            </DialogHeader>

            {/* ── The places ──────────────────────────────────────────── */}
            <section>
              <h3 className="mb-2 text-sm font-medium">
                Places ({count} of {MAX_SHORTLIST})
              </h3>
              <ul className="space-y-2">
                {shortlist.entries.map(e => (
                  <li key={e.listingId} className="flex items-center gap-2 rounded border p-2">
                    {e.imageUrl && <img src={e.imageUrl} alt="" className="h-10 w-14 rounded object-cover" />}
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
              {!enough && (
                <p className="mt-2 text-sm text-amber-700">
                  Add {MIN_SHORTLIST - count} more - we arrange viewings in one trip, so a
                  request covers {MIN_SHORTLIST} to {MAX_SHORTLIST} places.
                </p>
              )}

              {addable.length > 0 && count < MAX_SHORTLIST && (
                <div className="mt-3">
                  <h4 className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                    From your matches
                  </h4>
                  <ul className="space-y-1">
                    {addable.map(p => (
                      <li key={p.id} className="flex items-center gap-2 text-sm">
                        <span className="min-w-0 flex-1 truncate">{p.title}</span>
                        <Button
                          type="button" size="sm" variant="outline"
                          onClick={() => {
                            const r = shortlist.toggle({
                              listingId: p.id, title: p.title, imageUrl: p.images?.[0] ?? null,
                            });
                            if (!r.ok) toast.error(r.error ?? 'That request is full.');
                          }}
                        >
                          <Plus className="mr-1 h-3 w-3" /> Add
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            {/* ── When ────────────────────────────────────────────────── */}
            <section>
              <h3 className="mb-1 text-sm font-medium">When are you free?</h3>
              <p className="mb-2 text-xs text-muted-foreground">
                Pick a date, then the times that suit. We need two days to reach the
                agents, so the soonest is {earliest}.
              </p>
              <Calendar
                mode="single"
                onSelect={addDate}
                disabled={{ before: new Date(`${earliest}T00:00:00`), after: new Date(`${latest}T00:00:00`) }}
                className="rounded-md border"
              />

              {chosenDates.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {chosenDates.map(date => (
                    <li key={date} className="rounded border p-2">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-medium">{date}</span>
                        <Button
                          type="button" size="icon" variant="ghost" aria-label={`Remove ${date}`}
                          onClick={() => setPicked(prev => prev.filter(w => w.date !== date))}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="flex gap-2">
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
            </section>

            {/* ── Who ─────────────────────────────────────────────────── */}
            <section className="space-y-2">
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

            {shortOnCredits && (
              <p className="text-sm text-amber-700">
                This request covers {count} places and needs {count} viewing credits - you have{' '}
                {credits}. Remove a place, or top up.
              </p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button
              className="w-full"
              disabled={busy || !enough || picked.length === 0 || shortOnCredits}
              onClick={submit}
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Request {count} viewing{count === 1 ? '' : 's'}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Nothing is booked yet. We confirm with each agent first.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
