// Request intake. Shortlist 3-5 places, pick when you are free, leave a number.
//
// Deliberately says "request" everywhere and never "booking": at this point
// nothing is confirmed and an operator has not spoken to anyone yet. Promising
// a booking here is a promise we cannot keep (CLAUDE.md invariant 6).
import { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Check, Loader2, MapPin } from 'lucide-react';

interface Listing {
  id: string;
  title: string;
  price_vnd: number;
  bedrooms: number;
  area_sqm: number;
  district_code: string;
  city: string;
  images: string[] | null;
}

const MIN_PICKS = 3;
const MAX_PICKS = 5;

// Chips rather than a date picker. Ops schedules around a broker's availability,
// not the renter's calendar, so a precise time here would be a false promise -
// and half-day windows are what a broker actually answers.
const WINDOWS = [
  { id: 'weekday_am', label: 'Weekday mornings' },
  { id: 'weekday_pm', label: 'Weekday afternoons' },
  { id: 'weekday_eve', label: 'Weekday evenings' },
  { id: 'sat_am', label: 'Saturday morning' },
  { id: 'sat_pm', label: 'Saturday afternoon' },
  { id: 'sun', label: 'Sunday' },
];

const vnd = (n: number) => `${n.toLocaleString('vi-VN')} ₫`;

export default function ViewingRequest() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [windows, setWindows] = useState<string[]>([]);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ref: string; waLink: string | null; itemCount: number } | null>(null);

  useEffect(() => {
    (async () => {
      // The same four columns the shortlist index requires. A listing missing
      // any of them is searchable but cannot be requested, so it is not offered.
      const { data, error } = await supabase
        .from('external_properties')
        .select('id, title, price_vnd, bedrooms, area_sqm, district_code, city, images')
        .eq('is_active', true)
        .eq('price_confidence', 'HIGH')
        .not('price_vnd', 'is', null)
        .not('bedrooms', 'is', null)
        .not('area_sqm', 'is', null)
        .not('district_code', 'is', null)
        .order('price_vnd', { ascending: true })
        .limit(60);
      if (error) toast.error('Could not load places');
      setListings((data ?? []) as Listing[]);
      setLoading(false);
    })();
  }, []);

  const toggle = (id: string) =>
    setPicked(p => {
      if (p.includes(id)) return p.filter(x => x !== id);
      if (p.length >= MAX_PICKS) {
        toast.info(`Five is the most we can see in a day.`);
        return p;
      }
      return [...p, id];
    });

  const canSubmit = useMemo(
    () => picked.length >= MIN_PICKS && windows.length > 0 && phone.trim().length >= 9 && !submitting,
    [picked, windows, phone, submitting],
  );

  const submit = async () => {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('viewing-request', {
        body: { phone, name: name || null, listingIds: picked, availability: { windows } },
      });
      if (error) throw error;
      if (data?.error) {
        toast.error(data.message ?? 'Could not send that request');
        return;
      }
      setResult({ ref: data.ref, waLink: data.waLink, itemCount: data.itemCount });
    } catch (e) {
      toast.error((e as Error).message || 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16">
        <Helmet><title>Request {result.ref} · Hausto</title></Helmet>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Check className="h-5 w-5 text-green-600" /> Request {result.ref}
            </CardTitle>
            <CardDescription>
              We are checking {result.itemCount} places with the agents now. You will hear back on
              WhatsApp - usually within a few hours.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Partial success is the normal outcome, so it is said up front
                rather than discovered when three of five come back. */}
            <p className="text-sm text-muted-foreground">
              Not every place will be free at the times you picked - that is normal. We will come back
              with whichever ones are, and suggest alternatives for the rest.
            </p>
            {result.waLink && (
              <Button asChild className="w-full">
                <a href={result.waLink} target="_blank" rel="noreferrer">Open WhatsApp</a>
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              Keep the reference {result.ref} - quote it if you message us.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <Helmet><title>Request viewings · Hausto</title></Helmet>

      <h1 className="text-2xl font-semibold">Request viewings</h1>
      <p className="mt-1 text-muted-foreground">
        Pick three to five places. We contact the agents, line up a route, and send it to you on WhatsApp.
        You never talk to an agent.
      </p>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">Choose places</h2>
          <Badge variant={picked.length >= MIN_PICKS ? 'default' : 'secondary'}>
            {picked.length} of {MAX_PICKS} chosen
          </Badge>
        </div>

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}
          </div>
        ) : listings.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing is available to request right now.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {listings.map(l => {
              const on = picked.includes(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => toggle(l.id)}
                  aria-pressed={on}
                  className={`rounded-lg border p-3 text-left transition ${
                    on ? 'border-primary ring-2 ring-primary/30' : 'hover:border-muted-foreground/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="line-clamp-2 text-sm font-medium">{l.title}</span>
                    {on && <Check className="h-4 w-4 shrink-0 text-primary" />}
                  </div>
                  <div className="mt-2 text-sm">{vnd(l.price_vnd)}<span className="text-muted-foreground"> / month</span></div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" />
                    {l.district_code}
                    <span>·</span>
                    {l.bedrooms === 0 ? 'Studio' : `${l.bedrooms} bed`}
                    <span>·</span>
                    {Math.round(l.area_sqm)} m²
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="font-medium">When are you free?</h2>
        <p className="text-sm text-muted-foreground">Pick every window that works - more options means more we can confirm.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {WINDOWS.map(w => {
            const on = windows.includes(w.id);
            return (
              <button
                key={w.id}
                type="button"
                aria-pressed={on}
                onClick={() => setWindows(s => on ? s.filter(x => x !== w.id) : [...s, w.id])}
                className={`rounded-full border px-3 py-1.5 text-sm transition ${
                  on ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-muted-foreground/40'
                }`}
              >
                {w.label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="mt-10 max-w-md space-y-4">
        <h2 className="font-medium">Where do we send it?</h2>
        <div className="space-y-2">
          <Label htmlFor="phone">WhatsApp number</Label>
          <Input id="phone" inputMode="tel" placeholder="0901 234 567" value={phone}
                 onChange={e => setPhone(e.target.value)} />
          <p className="text-xs text-muted-foreground">Vietnamese mobile. We only message you about this request.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="name">Name <span className="text-muted-foreground">(optional)</span></Label>
          <Input id="name" value={name} onChange={e => setName(e.target.value)} />
        </div>

        <Button className="w-full" disabled={!canSubmit} onClick={submit}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {picked.length < MIN_PICKS
            ? `Choose ${MIN_PICKS - picked.length} more`
            : windows.length === 0
              ? 'Pick a time that works'
              : 'Send request'}
        </Button>
        <p className="text-xs text-muted-foreground">
          Nothing is booked yet - we check with each agent first and come back to you.
        </p>
      </section>
    </main>
  );
}
