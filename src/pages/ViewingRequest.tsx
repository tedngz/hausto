// Request intake (PLAN-v3 S4). Shortlist → availability → phone → deep link.
//
// The page imports its rules straight from the edge function's shared module
// rather than restating them, so "3 to 5" and "14 days ahead" cannot be true in
// one place and nearly true in the other. The function re-validates everything
// anyway - this is a better error message, not a check.
//
// Note the vocabulary: "request", never "booking", until state is CONFIRMED
// (CLAUDE.md invariant 6). At this point nothing has been agreed with anybody.

import { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useShortlist, MIN_SHORTLIST } from '@/hooks/useShortlist';
import {
  DAY_PARTS,
  MAX_DAYS_AHEAD,
  addDays,
  formatVnd,
  hcmcDate,
  toE164,
  type AvailabilityWindow,
  type DayPart,
} from '../../supabase/functions/_shared/viewing/intake.ts';

/**
 * What the shortlist row shows, read back from the listing rather than cached
 * when it was added.
 *
 * The price in particular: `external_properties.price` carries two currencies
 * and only its magnitude says which (SPEC §0), so the canonical `price_vnd` is
 * the only figure worth quoting a renter. Reading it here also surfaces a
 * listing that died since it was shortlisted *before* they fill in the form,
 * rather than as a rejection after they submit it.
 */
interface Hydrated {
  priceVnd: number | null;
  districtCode: string | null;
  gone: boolean;
}

interface Submitted {
  ref: string;
  waLink: string;
  accepted: string[];
  rejected: { listingId: string; reason: string }[];
}

const PART_LABEL: Record<DayPart, string> = {
  MORNING: 'Morning',
  AFTERNOON: 'Afternoon',
  EVENING: 'Evening',
};

export default function ViewingRequest() {
  const shortlist = useShortlist();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [picked, setPicked] = useState<AvailabilityWindow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rejected, setRejected] = useState<{ listingId: string; reason: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState<Submitted | null>(null);

  const [details, setDetails] = useState<Record<string, Hydrated>>({});

  const ids = shortlist.entries.map(e => e.listingId).join(',');
  useEffect(() => {
    if (!ids) { setDetails({}); return; }
    let cancelled = false;
    void (async () => {
      const pairs = await Promise.all(ids.split(',').map(async id => {
        const { data, error: err } = await supabase.functions.invoke('get-public-property', { body: { id } });
        const property = (data as { property?: Record<string, unknown> })?.property;
        // A listing the public endpoint will not return is one that has gone
        // inactive. Saying so here is the whole point of re-reading.
        if (err || !property) return [id, { priceVnd: null, districtCode: null, gone: true }] as const;
        return [id, {
          priceVnd: typeof property.price_vnd === 'number' ? property.price_vnd : null,
          districtCode: typeof property.district_code === 'string' ? property.district_code : null,
          gone: false,
        }] as const;
      }));
      if (!cancelled) setDetails(Object.fromEntries(pairs));
    })();
    return () => { cancelled = true; };
  }, [ids]);

  // Seven days of chips. The function accepts fourteen; offering all of them
  // makes the grid the page rather than a field on it.
  const days = useMemo(() => {
    const today = hcmcDate(new Date());
    return Array.from({ length: 7 }, (_, i) => addDays(today, i));
  }, []);

  const togglePart = (date: string, part: DayPart) => {
    setPicked(prev => {
      const exists = prev.some(w => w.date === date && w.part === part);
      if (exists) return prev.filter(w => !(w.date === date && w.part === part));
      if (prev.length >= 6) return prev;
      return [...prev, { date, part }];
    });
  };

  // A listing we already know is dead would come back as a rejection anyway.
  // Blocking here turns that into a fix the renter can make before filling in
  // the rest of the form.
  const hasGone = shortlist.entries.some(e => details[e.listingId]?.gone);

  const submit = async () => {
    setError(null);
    setRejected([]);
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
    const payload = data as Submitted & { error?: string; message?: string; rejected?: Submitted['rejected'] };
    if (payload?.error) {
      setError(payload.message ?? payload.error);
      // Partial success is the happy path (invariant 5), and its first
      // appearance is here: some of the shortlist went stale between browsing
      // and submitting, and the renter is told which ones rather than left to
      // guess.
      if (payload.rejected?.length) setRejected(payload.rejected);
      return;
    }
    setSubmitted(payload);
    shortlist.clear();
  };

  if (submitted) return <Confirmation submitted={submitted} />;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Helmet><title>Request viewings - Hausto</title></Helmet>

      <h1 className="text-2xl font-semibold">Request viewings</h1>
      <p className="mt-2 text-sm text-neutral-600">
        We contact each landlord or agent for you and come back with the times
        that are actually free. You never deal with them directly, and they never
        get your number.
      </p>

      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          Your shortlist ({shortlist.entries.length})
        </h2>
        {shortlist.entries.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-600">
            Nothing shortlisted yet. <Link className="underline" to="/browse">Find some places</Link> and add
            between {MIN_SHORTLIST} and 5.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {shortlist.entries.map(e => {
              const d = details[e.listingId];
              return (
              <li key={e.listingId} className="flex items-center gap-3 rounded border border-neutral-200 p-2">
                {e.imageUrl && <img src={e.imageUrl} alt="" className="h-12 w-16 rounded object-cover" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{e.title}</div>
                  <div className={`text-xs ${d?.gone ? 'text-amber-700' : 'text-neutral-500'}`}>
                    {d === undefined
                      ? 'Checking...'
                      : d.gone
                        ? 'No longer listed - remove it to continue'
                        : `${d.priceVnd != null ? formatVnd(d.priceVnd) : 'Price unconfirmed'}${d.districtCode ? ` - ${d.districtCode}` : ''}`}
                  </div>
                </div>
                <button
                  className="text-xs text-neutral-500 underline"
                  onClick={() => shortlist.remove(e.listingId)}
                >
                  Remove
                </button>
              </li>
              );
            })}
          </ul>
        )}
        {shortlist.entries.length > 0 && !shortlist.canSubmit && (
          <p className="mt-2 text-xs text-amber-700">
            Add {MIN_SHORTLIST - shortlist.entries.length} more. Fewer than {MIN_SHORTLIST} rarely comes back with
            enough free slots to make a trip worth it.
          </p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">When are you free?</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Pick up to six. We ask for a window rather than an exact time because
          the exact time is the agent's to offer - within the next {MAX_DAYS_AHEAD} days.
        </p>
        <div className="mt-3 space-y-2">
          {days.map(date => (
            <div key={date} className="flex items-center gap-2">
              <span className="w-24 shrink-0 text-xs text-neutral-600">
                {new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}
              </span>
              {DAY_PARTS.map(part => {
                const on = picked.some(w => w.date === date && w.part === part);
                return (
                  <button
                    key={part}
                    onClick={() => togglePart(date, part)}
                    className={`rounded-full border px-3 py-1 text-xs ${on ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-neutral-300 text-neutral-700'}`}
                  >
                    {PART_LABEL[part]}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Where do we reach you?</h2>
        <input
          className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
          placeholder="Your name"
          value={name}
          onChange={e => setName(e.target.value)}
        />
        <input
          className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
          placeholder="WhatsApp number, e.g. 0901 234 567"
          value={phone}
          onChange={e => setPhone(e.target.value)}
        />
        <p className="text-xs text-neutral-500">
          We reply on WhatsApp. Your number is never shown to a landlord or agent.
        </p>
      </section>

      {error && <div className="mt-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {rejected.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-amber-800">
          {rejected.map(r => {
            const entry = shortlist.entries.find(e => e.listingId === r.listingId);
            return <li key={r.listingId}>{entry?.title ?? r.listingId}: {r.reason}</li>;
          })}
        </ul>
      )}

      <button
        className="mt-6 w-full rounded bg-emerald-600 px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
        disabled={busy || hasGone || !shortlist.canSubmit || picked.length === 0 || !phone.trim()}
        onClick={() => void submit()}
      >
        {busy ? 'Sending...' : 'Request these viewings'}
      </button>
    </div>
  );
}

/**
 * The handshake, and the reason this page does not simply say "done".
 *
 * There is no 24-hour service window until the renter messages us first, and no
 * approved template to open one with. So the link is not a nicety: tapping it is
 * what makes everything after this point sendable.
 */
function Confirmation({ submitted }: { submitted: Submitted }) {
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      <Helmet><title>Request {submitted.ref} - Hausto</title></Helmet>
      <h1 className="text-2xl font-semibold">Request {submitted.ref}</h1>
      <p className="mt-3 text-sm text-neutral-600">
        We are contacting {submitted.accepted.length} {submitted.accepted.length === 1 ? 'place' : 'places'} now.
        Expect an answer within a day - often fewer than you asked for, because
        not everything advertised is still free.
      </p>

      {submitted.rejected.length > 0 && (
        <p className="mt-3 text-xs text-amber-700">
          {submitted.rejected.length} of your shortlist could not be requested and were left out.
        </p>
      )}

      <a
        href={submitted.waLink}
        className="mt-6 inline-block rounded bg-emerald-600 px-6 py-3 text-sm font-medium text-white"
      >
        Open WhatsApp to finish
      </a>
      <p className="mt-3 text-xs text-neutral-500">
        Send us that first message - it is what lets us reply. Your reference is{' '}
        <strong>{submitted.ref}</strong>; quote it any time.
      </p>
    </div>
  );
}
