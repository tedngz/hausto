import { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router-dom';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ArrowDown, ArrowUp, ArrowUpDown, CalendarCheck, Loader2, MapPin, Scale, Sparkles } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useViewingQuota } from '@/hooks/useViewingQuota';
import { ViewingScheduleModal, ViewingScheduleData } from '@/components/ViewingScheduleModal';

// Public, no-auth browse table. Data comes from the public-property-search edge
// function, which never returns contact details — contacts stay behind sign-in.
const SEARCH_URL = 'https://gbgrwjdmytaksrztcyzs.supabase.co/functions/v1/public-property-search';
const PAGE_SIZE = 50; // API max per request
const MAX_ROWS = 200;

type Row = {
  id: string;
  title: string;
  url: string;
  source_url?: string;
  location: string;
  price_vnd: number | null;
  price_usd: number | null;
  rooms: string | null;
  size: string | null;
  vibe: string | null;
  images: string[];
  source: string;
  listed_at: string;
  last_verified_at?: string | null;
  posting_count?: number;
};

type SortKey = 'price_usd' | 'last_verified_at' | 'rooms' | 'size';

const CITIES = [
  { value: 'all', label: 'All cities' },
  { value: 'hcmc', label: 'Ho Chi Minh City' },
  { value: 'hanoi', label: 'Hanoi' },
  { value: 'danang', label: 'Da Nang' },
];

const ROOM_OPTIONS = [
  { value: 'all', label: 'Any rooms' },
  { value: 'studio', label: 'Studio' },
  { value: '1', label: '1 bedroom' },
  { value: '2', label: '2 bedrooms' },
  { value: '3', label: '3+ bedrooms' },
];

const daysAgo = (iso?: string | null): number | null => {
  if (!iso) return null;
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d >= 0 ? d : null;
};

const verifiedLabel = (iso?: string | null): string => {
  const d = daysAgo(iso);
  if (d === null) return '—';
  if (d === 0) return 'today';
  return `${d}d ago`;
};

const parseSizeNum = (size?: string | null): number | null => {
  const m = String(size ?? '').match(/(\d+(?:[.,]\d+)?)/);
  return m ? parseFloat(m[1].replace(',', '.')) : null;
};

const districtOf = (location: string): string => {
  // Location format is "Project, Ward, District, City" — show the middle part.
  const parts = (location || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return location;
  return parts.slice(0, -1).slice(-2).join(', ');
};

const Browse = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [city, setCity] = useState('all');
  const [district, setDistrict] = useState('');
  const [districtInput, setDistrictInput] = useState('');
  const [roomsFilter, setRoomsFilter] = useState('all');
  const [maxBudget, setMaxBudget] = useState('');
  const [freshOnly, setFreshOnly] = useState(false);

  // Sorting
  const [sortKey, setSortKey] = useState<SortKey>('last_verified_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Compare + fast-track
  const [selected, setSelected] = useState<Row[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const { user } = useAuth();
  const { quota, refetchQuota } = useViewingQuota();

  const openFastTrack = () => {
    if (!user) {
      navigate('/auth', { state: { returnTo: '/browse' } });
      return;
    }
    if (quota && !quota.canBook) {
      toast.error('Viewing bookings used up for this cycle', {
        description: 'Upgrade or purchase the unlimited add-on from your matches page to book more.',
      });
      return;
    }
    setScheduleOpen(true);
  };

  const submitFastTrack = async (scheduleData: ViewingScheduleData) => {
    if (!user) return;
    try {
      // Browse requests have no chat conversation or matched realtor yet —
      // ops picks them up from the admin queue and coordinates directly.
      const { error: insertError } = await supabase.from('fast_track_requests').insert({
        conversation_id: null,
        realtor_id: null,
        renter_id: user.id,
        property_ids: scheduleData.selectedPropertyIds,
        preferred_dates: scheduleData.dates.map((d) => format(d, 'yyyy-MM-dd')),
        preferred_times: scheduleData.preferredTimes,
        special_requirements: scheduleData.specialRequirements || null,
        status: 'pending',
        source: 'browse',
      } as any);
      if (insertError) throw insertError;

      // Notification is best-effort; the request row is the source of truth.
      try {
        const { data: profile } = await supabase
          .from('profiles').select('name, email').eq('id', user.id).single();
        const chosen = selected.filter((r) => scheduleData.selectedPropertyIds.includes(r.id));
        await supabase.functions.invoke('notify-fast-track-request', {
          body: {
            renterName: profile?.name || 'User',
            renterEmail: profile?.email || user.email || '',
            preferredDates: scheduleData.dates.map((d) => format(d, 'MMM dd, yyyy')),
            preferredTimes: scheduleData.preferredTimes,
            specialRequirements: scheduleData.specialRequirements || '',
            properties: chosen.map((r) => ({
              id: r.id, title: r.title, location: r.location,
              price: r.price_vnd || 0, imageUrl: r.images?.[0] || '',
            })),
            conversationId: null,
          },
        });
      } catch (e) {
        console.error('Fast-track notification failed:', e);
      }

      refetchQuota();
      setScheduleOpen(false);
      setSelected([]);
      toast.success('Viewing request sent', {
        description: "We'll confirm availability with the agents and send you a schedule.",
      });
    } catch (e) {
      console.error('Fast-track request failed:', e);
      toast.error('Could not send the request. Please try again.');
    }
  };

  // Debounce free-text district input
  useEffect(() => {
    const t = setTimeout(() => setDistrict(districtInput.trim()), 400);
    return () => clearTimeout(t);
  }, [districtInput]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (city !== 'all') params.set('city', city);
        if (district) params.set('district', district);
        if (maxBudget && Number(maxBudget) > 0) params.set('max_budget', maxBudget);
        params.set('limit', String(PAGE_SIZE));
        const collected: Row[] = [];
        for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
          params.set('offset', String(offset));
          const res = await fetch(`${SEARCH_URL}?${params}`);
          if (!res.ok) throw new Error(`Search failed (${res.status})`);
          const data = await res.json();
          collected.push(...(data.results || []));
          if ((data.results || []).length < PAGE_SIZE) break;
        }
        if (!cancelled) setRows(collected);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [city, district, maxBudget]);

  const filtered = useMemo(() => {
    let out = rows;
    if (roomsFilter !== 'all') {
      out = out.filter((r) => {
        const rr = (r.rooms || '').toLowerCase();
        if (roomsFilter === 'studio') return rr.includes('studio');
        if (roomsFilter === '3') return /[3-9]/.test(rr);
        return rr.includes(roomsFilter);
      });
    }
    if (freshOnly) {
      out = out.filter((r) => {
        const d = daysAgo(r.last_verified_at);
        return d !== null && d <= 7;
      });
    }
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...out].sort((a, b) => {
      let av: number, bv: number;
      if (sortKey === 'price_usd') {
        av = a.price_usd ?? Infinity; bv = b.price_usd ?? Infinity;
      } else if (sortKey === 'size') {
        av = parseSizeNum(a.size) ?? -1; bv = parseSizeNum(b.size) ?? -1;
      } else if (sortKey === 'rooms') {
        const n = (r: Row) => (r.rooms || '').toLowerCase().includes('studio') ? 0 : (parseInt(r.rooms || '') || parseSizeNum(r.rooms) || 99);
        av = n(a); bv = n(b);
      } else {
        av = a.last_verified_at ? new Date(a.last_verified_at).getTime() : 0;
        bv = b.last_verified_at ? new Date(b.last_verified_at).getTime() : 0;
      }
      return (av - bv) * dir;
    });
  }, [rows, roomsFilter, freshOnly, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'last_verified_at' ? 'desc' : 'asc'); }
  };

  const toggleSelect = (row: Row) => {
    setSelected((cur) => {
      if (cur.some((r) => r.id === row.id)) return cur.filter((r) => r.id !== row.id);
      if (cur.length >= 4) return cur;
      return [...cur, row];
    });
  };

  const SortHeader = ({ label, k, className = '' }: { label: string; k: SortKey; className?: string }) => (
    <TableHead className={className}>
      <button className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort(k)}>
        {label}
        {sortKey === k ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
      </button>
    </TableHead>
  );

  const compareFields: { label: string; get: (r: Row) => string }[] = [
    { label: 'Location', get: (r) => r.location },
    { label: 'Price', get: (r) => (r.price_usd ? `$${r.price_usd}/mo` : '—') },
    { label: 'Rooms', get: (r) => r.rooms || '—' },
    { label: 'Size', get: (r) => r.size || '—' },
    { label: 'Vibe', get: (r) => r.vibe || '—' },
    { label: 'Verified live', get: (r) => verifiedLabel(r.last_verified_at) },
    { label: 'Postings', get: (r) => String(r.posting_count || 1) },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-red-50">
      <Helmet>
        <title>Browse rentals — Hausto</title>
        <meta name="description" content="Compare verified rental apartments in Ho Chi Minh City, Hanoi, and Da Nang. Sortable table with prices, sizes, and freshness — duplicates merged." />
        <link rel="canonical" href="https://hausto.lovable.app/browse" />
      </Helmet>

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-serif font-medium">Browse rentals</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Every listing checked against its source — duplicates merged, dead listings removed.
            </p>
          </div>
          <Button variant="outline" onClick={() => navigate('/discover')}>
            <Sparkles className="w-4 h-4 mr-2" />
            Vibe match instead
          </Button>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <Select value={city} onValueChange={setCity}>
            <SelectTrigger className="w-[180px] bg-background"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CITIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input
            placeholder="District or area…"
            value={districtInput}
            onChange={(e) => setDistrictInput(e.target.value)}
            className="w-[180px] bg-background"
          />
          <Select value={roomsFilter} onValueChange={setRoomsFilter}>
            <SelectTrigger className="w-[150px] bg-background"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ROOM_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input
            type="number"
            placeholder="Max $/mo"
            value={maxBudget}
            onChange={(e) => setMaxBudget(e.target.value)}
            className="w-[120px] bg-background"
          />
          <div className="flex items-center gap-2">
            <Switch id="fresh" checked={freshOnly} onCheckedChange={setFreshOnly} />
            <Label htmlFor="fresh" className="text-sm cursor-pointer">Verified this week</Label>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : error ? (
          <p className="text-center py-24 text-muted-foreground">Couldn't load listings: {error}</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground mb-2">{filtered.length} listings</p>
            <div className="rounded-lg border bg-background overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"><Scale className="w-3.5 h-3.5" /></TableHead>
                    <TableHead>Property</TableHead>
                    <TableHead className="hidden md:table-cell">Location</TableHead>
                    <SortHeader label="Rooms" k="rooms" className="hidden sm:table-cell" />
                    <SortHeader label="Size" k="size" className="hidden sm:table-cell" />
                    <SortHeader label="Price" k="price_usd" />
                    <SortHeader label="Verified" k="last_verified_at" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => {
                    const fresh = daysAgo(r.last_verified_at);
                    return (
                      <TableRow
                        key={r.id}
                        className="cursor-pointer"
                        onClick={() => navigate(`/property/${r.id}`)}
                      >
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selected.some((s) => s.id === r.id)}
                            onCheckedChange={() => toggleSelect(r)}
                            aria-label="Select for comparison"
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3 min-w-[220px]">
                            {r.images?.[0] && (
                              <img
                                src={r.images[0]}
                                alt=""
                                loading="lazy"
                                className="w-14 h-10 rounded object-cover flex-shrink-0 hidden sm:block"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                            )}
                            <div className="min-w-0">
                              <p className="font-medium text-sm line-clamp-1">{r.title}</p>
                              <p className="text-xs text-muted-foreground line-clamp-1 md:hidden flex items-center gap-1">
                                <MapPin className="w-3 h-3 flex-shrink-0" />{districtOf(r.location)}
                              </p>
                              {(r.posting_count || 1) > 1 && (
                                <Badge variant="secondary" className="mt-0.5 text-[10px] py-0">
                                  {r.posting_count} agents posting
                                </Badge>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground max-w-[220px]">
                          <span className="line-clamp-1">{districtOf(r.location)}</span>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm whitespace-nowrap">{r.rooms || '—'}</TableCell>
                        <TableCell className="hidden sm:table-cell text-sm whitespace-nowrap">{r.size && r.size !== 'Not specified' ? r.size : '—'}</TableCell>
                        <TableCell className="text-sm font-medium whitespace-nowrap">
                          {r.price_usd ? `$${r.price_usd.toLocaleString()}` : '—'}
                          <span className="text-xs text-muted-foreground font-normal">/mo</span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1.5 text-xs ${fresh !== null && fresh <= 7 ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                            {fresh !== null && fresh <= 7 && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                            {verifiedLabel(r.last_verified_at)}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {filtered.length === 0 && (
                <p className="text-center py-12 text-sm text-muted-foreground">No listings match these filters.</p>
              )}
            </div>
          </>
        )}
      </main>

      {/* Compare bar */}
      {selected.length > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-full bg-foreground text-background px-5 py-2.5 shadow-lg">
          <span className="text-sm">{selected.length} selected</span>
          <Button size="sm" variant="secondary" className="rounded-full h-7" disabled={selected.length < 2} onClick={() => setCompareOpen(true)}>
            Compare
          </Button>
          <Button size="sm" className="rounded-full h-7" onClick={openFastTrack}>
            <CalendarCheck className="w-3.5 h-3.5 mr-1.5" />
            Request viewings
          </Button>
          <button className="text-xs opacity-70 hover:opacity-100" onClick={() => setSelected([])}>Clear</button>
        </div>
      )}

      <ViewingScheduleModal
        isOpen={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onSubmit={submitFastTrack}
        matchedProperties={selected.map((r) => ({
          id: r.id, title: r.title, images: r.images,
          location: r.location, price: r.price_vnd || undefined,
        }))}
        initialSelectedIds={selected.map((r) => r.id)}
        onPropertyClick={(id) => navigate(`/property/${id}`)}
      />

      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>Compare listings</DialogTitle></DialogHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left p-2 w-28" />
                  {selected.map((r) => (
                    <th key={r.id} className="text-left p-2 align-top min-w-[160px]">
                      {r.images?.[0] && <img src={r.images[0]} alt="" className="w-full h-24 rounded object-cover mb-2" />}
                      <button className="font-medium hover:underline text-left line-clamp-2" onClick={() => navigate(`/property/${r.id}`)}>
                        {r.title}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {compareFields.map((f) => (
                  <tr key={f.label} className="border-t">
                    <td className="p-2 text-muted-foreground">{f.label}</td>
                    {selected.map((r) => <td key={r.id} className="p-2">{f.get(r)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Browse;
