import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { PASS_DAYS, PASS_PRICE_USD, usePass } from '@/hooks/usePass';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { DigestOptIn } from '@/components/DigestOptIn';
import { supabase } from '@/integrations/supabase/client';
import { CITY_DISTRICTS } from '@/utils/districts';
import { Loader2, MessageCircle, Search } from 'lucide-react';
import {
  MAX_AREA_DISTRICTS, REPLY_WITHIN_HOURS, districtCodeOf,
} from '../../supabase/functions/_shared/viewing/place.ts';

/** What a thin search already knows, so Search for me opens filled in. */
export interface SearchPrefill {
  /** District names as the renter app writes them: "District 2", "Binh Thanh". */
  districts?: string[];
  bedrooms?: number | null;
  budgetMaxVnd?: number | null;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
} & (
  | { complexId: string; complexName: string; search?: undefined }
  | { search: SearchPrefill; complexId?: undefined; complexName?: undefined }
);

interface WhatsAppHandoff { code: string; waLink: string; alertsUntil: string; place: string }

const LEASES = [6, 12, 24] as const;
const BEDROOMS = [1, 2, 3, 4] as const;

const vnd = (dong: number) => `${dong.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ₫`;
// A rough guide for renters who think in dollars - the listings they have seen
// elsewhere often are. Never stored.
const usd = (dong: number) => `US$${(Math.round(dong / 25_000 / 50) * 50).toLocaleString('en-US')}`;

/** Today in Ho Chi Minh City, `YYYY-MM-DD`. */
const hcmcToday = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

/** "District 2", "District 2 and Binh Thanh", "District 2, Binh Thanh and District 7". */
const joinPlaces = (names: string[]) =>
  names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/**
 * "Request availability at Empire City" (SPEC §11), and Search for me - the
 * same ask for an area, which is the Pass's.
 *
 * A person on our team asks the agents and replies on WhatsApp: within 24
 * hours for a building, which is free for everyone, and within 48 for an area,
 * where they search agents' circles and Facebook groups. One form, then one
 * message: the renter sends us the text WhatsApp opens with. That message is
 * the opt-in and proves the number is theirs, so the form never asks for one -
 * any country's works - and the clock starts when it arrives.
 */
export function ConciergeCaptureModal({ open, onOpenChange, complexId, complexName, search }: Props) {
  const { user } = useAuth();
  const { pass, isLoading: passLoading, purchasePass, refetchPass } = usePass();
  const navigate = useNavigate();
  const location = useLocation();
  const isSearch = !!search;

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);
  const [handoff, setHandoff] = useState<WhatsAppHandoff | null>(null);
  const [buying, setBuying] = useState(false);
  const [digestOptIn, setDigestOptIn] = useState(false);

  const [districts, setDistricts] = useState<string[]>([]);
  const [moveIn, setMoveIn] = useState('');
  const [lease, setLease] = useState<number>(12);
  const [bedrooms, setBedrooms] = useState<number>(2);
  const [budgetMillions, setBudgetMillions] = useState('');
  const [hasPets, setHasPets] = useState(false);
  const [notes, setNotes] = useState('');
  const [name, setName] = useState('');

  const reset = () => {
    setError(null); setHandoff(null); setSubmitting(false);
    setDistricts([]); setMoveIn(''); setLease(12); setBedrooms(2); setBudgetMillions(''); setHasPets(false); setNotes('');
    setName(''); setPrefilled(false);
  };

  // Logged-in renters shouldn't retype what Hausto already knows.
  useEffect(() => {
    if (!open || !user || prefilled) return;
    let cancelled = false;
    (async () => {
      const { data: profile } = await supabase.from('profiles').select('name').eq('id', user.id).maybeSingle();
      if (cancelled) return;
      setName(prev => prev || profile?.name || user.user_metadata?.name || '');
      setPrefilled(true);
    })();
    return () => { cancelled = true; };
  }, [open, user, prefilled]);

  // Nor what the search they came from already said. Keyed on its content,
  // not its identity: the caller builds a fresh object every render.
  const prefillKey = search ? JSON.stringify(search) : '';
  useEffect(() => {
    if (!open || !prefillKey) return;
    const p = JSON.parse(prefillKey) as SearchPrefill;
    setDistricts((p.districts ?? []).filter(d => !!districtCodeOf(d)).slice(0, MAX_AREA_DISTRICTS));
    if (p.bedrooms) setBedrooms(Math.min(Math.max(Math.round(p.bedrooms), 1), 4));
    if (p.budgetMaxVnd) setBudgetMillions(String(Math.round(p.budgetMaxVnd / 1_000_000)));
  }, [open, prefillKey]);

  const close = () => { onOpenChange(false); setTimeout(reset, 300); };

  const budgetVnd = budgetMillions.trim() ? Math.round(Number(budgetMillions) * 1_000_000) : null;
  const budgetValid = budgetVnd !== null && Number.isFinite(budgetVnd) && budgetVnd >= 3_000_000 && budgetVnd <= 500_000_000;
  const canSubmit = !!moveIn && moveIn >= hcmcToday() && budgetValid && !!name.trim() && (!isSearch || districts.length > 0);

  // The districts on offer: the city's, plus any the search named that the
  // list does not carry.
  const districtChoices = [...new Set([...CITY_DISTRICTS.hcmc, ...districts])];
  const toggleDistrict = (d: string) => setDistricts(cur =>
    cur.includes(d) ? cur.filter(x => x !== d) : cur.length >= MAX_AREA_DISTRICTS ? cur : [...cur, d]);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const token = isSearch ? (await supabase.auth.getSession()).data.session?.access_token : undefined;
    const { data, error: fnError } = await supabase.functions.invoke('complex-inquiry-create', {
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      body: {
        ...(isSearch
          ? { areaDistrictCodes: districts.map(districtCodeOf).filter((c): c is string => !!c) }
          : { complexId }),
        name: name.trim(),
        moveInDate: moveIn,
        leaseMonths: lease,
        bedrooms,
        budgetMaxVnd: budgetVnd,
        hasPets,
        notes: notes.trim() || null,
      },
    });
    setSubmitting(false);
    if (fnError || !data?.success) {
      let message = isSearch ? 'Could not start your search. Try again in a moment.' : 'Could not send your request. Try again in a moment.';
      // supabase-js hides a non-2xx body behind `context`; the function's own
      // message says what to fix.
      try {
        const body = await (fnError as { context?: Response })?.context?.json();
        if (body?.message) message = body.message;
        // The Pass ran out since this opened: re-read it, and the pitch replaces the form.
        if (body?.error === 'pass_required') void refetchPass();
      } catch { /* keep the generic message */ }
      setError(message);
      return;
    }
    setHandoff({ code: data.code, waLink: data.waLink, alertsUntil: data.alertsUntil, place: data.complexName });
  };

  const buyPass = async () => {
    setBuying(true);
    try {
      await purchasePass(undefined, { digestOptIn });
    } finally {
      setBuying(false);
    }
  };

  const until = handoff
    ? new Date(handoff.alertsUntil).toLocaleDateString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: 'numeric', month: 'short' })
    : '';
  const placeName = isSearch ? joinPlaces(districts) : complexName;
  const hours = REPLY_WITHIN_HOURS[isSearch ? 'AREA' : 'BUILDING'];

  // Search for me is the Pass's: a person's hours, not a form's. The building
  // request stays free for everyone.
  const gate = !isSearch || handoff ? null
    : !user ? 'SIGN_IN'
    : passLoading ? 'LOADING'
    : !pass?.active ? 'PASS'
    : null;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : close())}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        {gate === 'LOADING' ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
          </div>
        ) : gate === 'SIGN_IN' || gate === 'PASS' ? (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl">Priority search</DialogTitle>
              <DialogDescription>When the place you want is not in the table</DialogDescription>
            </DialogHeader>
            <p className="text-sm">
              A person on our team searches Facebook groups and agents' circles for places that fit, and sends the
              first ones on WhatsApp within {REPLY_WITHIN_HOURS.AREA} hours - each one confirmed with its agent.
            </p>
            {gate === 'SIGN_IN' ? (
              <>
                <p className="text-sm text-muted-foreground">Sign in to ask us to search for you.</p>
                <Button className="w-full" size="lg"
                  onClick={() => navigate('/auth', { state: { returnTo: `${location.pathname}${location.search}` } })}>
                  Sign in
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  It comes with the Pass: ${PASS_PRICE_USD} for {PASS_DAYS} days, one-off. The Pass also covers every
                  viewing agents confirm.
                </p>
                <DigestOptIn checked={digestOptIn} onChange={setDigestOptIn} />
                <Button className="w-full" size="lg" onClick={buyPass} disabled={buying}>
                  {buying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" /> : null}
                  Get the Pass - ${PASS_PRICE_USD}
                </Button>
              </>
            )}
            <p className="text-xs text-muted-foreground">
              Asking about one building stays free: use Request availability on its page.
            </p>
          </div>
        ) : handoff ? (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl">Send it on WhatsApp</DialogTitle>
              <DialogDescription>
                {handoff.place} · Step 2 of 2
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm">
              Send us the message WhatsApp opens with. That is where we reply.
            </p>
            <Button asChild className="w-full" size="lg">
              <a href={handoff.waLink} target="_blank" rel="noreferrer">
                <MessageCircle className="h-4 w-4 mr-2" aria-hidden="true" />
                Open WhatsApp
              </a>
            </Button>
            <p className="text-sm text-muted-foreground">
              {isSearch
                ? `A person on our team searches agents' circles and Facebook groups in ${handoff.place}, and sends the first places there within ${hours} hours of your message - each one confirmed with its agent.`
                : `A person on our team checks with the agents who hold units at ${handoff.place} and replies there within ${hours} hours of your message.`}
              {' '}Until {until} we will also tell you when a new listing there fits. Reply STOP any time.
            </p>
            <p className="text-xs text-muted-foreground">
              Your code is <span className="font-mono font-medium text-foreground">{handoff.code}</span> - it works for a week.
            </p>
            <Button variant="ghost" className="w-full" onClick={close}>Done</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-serif text-2xl">{isSearch ? 'Priority search' : 'Request availability'}</DialogTitle>
              <DialogDescription>
                {isSearch ? 'Step 1 of 2' : `${complexName} · Step 1 of 2`}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {isSearch && (
                <div className="space-y-2">
                  <Label>Where</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {districtChoices.map((d) => {
                      const active = districts.includes(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          onClick={() => toggleDistrict(d)}
                          aria-pressed={active}
                          className={`rounded-full px-2.5 py-1 text-xs border transition-colors ${
                            active
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-background border-border text-muted-foreground hover:border-primary/50'
                          }`}
                        >
                          {d}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Up to {MAX_AREA_DISTRICTS} districts in Ho Chi Minh City{placeName ? ` - ${placeName}` : ''}.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="movein">Move-in date</Label>
                  <Input id="movein" type="date" min={hcmcToday()} value={moveIn} onChange={(e) => setMoveIn(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Lease</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {LEASES.map((m) => (
                      <Button key={m} type="button" variant={lease === m ? 'default' : 'outline'} onClick={() => setLease(m)}>
                        {m === 24 ? '24+' : m}m
                      </Button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Bedrooms</Label>
                <div className="grid grid-cols-4 gap-2">
                  {BEDROOMS.map((b) => (
                    <Button key={b} type="button" variant={bedrooms === b ? 'default' : 'outline'} onClick={() => setBedrooms(b)}>
                      {b === 4 ? '4+' : b}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="budget">Most you would pay a month</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="budget"
                    inputMode="decimal"
                    placeholder="e.g. 25"
                    value={budgetMillions}
                    onChange={(e) => setBudgetMillions(e.target.value.replace(/[^0-9.]/g, ''))}
                  />
                  <span className="text-sm text-muted-foreground whitespace-nowrap">million ₫</span>
                </div>
                {budgetVnd !== null && (
                  <p className={`text-xs ${budgetValid ? 'text-muted-foreground' : 'text-destructive'}`}>
                    {budgetValid
                      ? `Up to ${vnd(budgetVnd)} a month (about ${usd(budgetVnd)})`
                      : 'Enter an amount between 3 and 500 million.'}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <Label htmlFor="pets" className="cursor-pointer">Bringing a pet?</Label>
                <Switch id="pets" checked={hasPets} onCheckedChange={setHasPets} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Anything specific? (optional)</Label>
                <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)}
                  placeholder={isSearch ? 'Near an international school, high floor, furnished…' : 'High floor, river view, furnished…'} rows={2} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="name">Your name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button className="w-full" size="lg" onClick={submit} disabled={!canSubmit || submitting}>
                {submitting
                  ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
                  : isSearch
                    ? <Search className="h-4 w-4 mr-2" aria-hidden="true" />
                    : <MessageCircle className="h-4 w-4 mr-2" aria-hidden="true" />}
                Continue on WhatsApp
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                {isSearch
                  ? `First places on WhatsApp within ${hours} hours, each confirmed with its agent. One search at a time. Any country's number works.`
                  : `A person replies on WhatsApp within ${hours} hours. Any country's number works.`}
              </p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
