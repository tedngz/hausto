import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ArrowDown, ArrowUp, ArrowUpDown, CalendarCheck, ChevronDown, ChevronLeft, ChevronRight, Loader2, MapPin, Scale, Sparkles, X } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useMatches } from '@/hooks/useMatches';
import { useBrowseListings, type BrowseRow } from '@/hooks/useBrowseListings';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { useViewingQuota } from '@/hooks/useViewingQuota';
import { ViewingScheduleModal, ViewingScheduleData } from '@/components/ViewingScheduleModal';
import { EditorialPropertyCard } from '@/components/EditorialPropertyCard';
import { VibeMatchPopover } from '@/components/VibeMatchPopover';
import { SubscriptionModal } from '@/components/SubscriptionModal';
import { HAUSTO_AGENT_ID } from '@/constants/haustoAgent';
import { getPropertySourceLogo } from '@/utils/propertySourceLogos';
import { calculateVibeScore, getVibeAttributeMatch } from '@/utils/vibeScoring';
import { getVibeRatingLabel } from '@/utils/vibeRating';
import { CITY_DISTRICTS, districtOf, locationMatchesDistrict } from '@/utils/districts';
import { ASSISTANT_COMPARE_EVENT, listSubjects, type AssistantCompareDetail } from '@/lib/assistantEvents';
import { HubPanelScrim } from '@/components/hub/HubPanelScrim';
import { HUB_PANE_CENTRED, HUB_PANEL_POSITION } from '@/lib/hubLayout';
import { ListingPreviewDialog } from '@/components/ListingPreviewDialog';
import type { Apartment } from '@/types';

// The verified-listings table. Public data from public-property-search (no
// contact details); rendered standalone at /browse, as the Browse view inside
// Discover, and as the hub's Browse tab. The listing set itself is fetched by
// useBrowseListings, which the hub's new-listings strip shares.
export type { BrowseRow };

type SortKey = 'price_usd' | 'last_verified_at' | 'rooms' | 'size';

const CITIES = [
  { value: 'all', label: 'All cities' },
  { value: 'hcmc', label: 'Ho Chi Minh City' },
  { value: 'hanoi', label: 'Hanoi' },
  { value: 'danang', label: 'Da Nang' },
];

// Rating-dot colors, mirroring EditorialPropertyCard's chip
const RATING_DOT: Record<string, string> = {
  perfect: 'bg-emerald-400',
  strong: 'bg-blue-400',
  good: 'bg-orange-400',
  casual: 'bg-gray-300',
};

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
  if (d === null) return '-';
  if (d === 0) return 'today';
  return `${d}d ago`;
};

const parseSizeNum = (size?: string | null): number | null => {
  const m = String(size ?? '').match(/(\d+(?:[.,]\d+)?)/);
  return m ? parseFloat(m[1].replace(',', '.')) : null;
};

// Card-style image browser for the compare dialog: one photo at a time with
// arrows and progress segments, mirroring the editorial property card.
const CompareImageCarousel = ({ images, alt }: { images: string[]; alt: string }) => {
  const [idx, setIdx] = useState(0);
  const list = images && images.length > 0 ? images : [];
  if (list.length === 0) {
    return <div className="aspect-[4/3] rounded bg-secondary" />;
  }
  const go = (delta: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setIdx((i) => (i + delta + list.length) % list.length);
  };
  return (
    <div className="relative aspect-[4/3] rounded overflow-hidden group/carousel">
      <img
        src={list[idx]}
        alt={alt}
        loading="lazy"
        className="absolute inset-0 w-full h-full object-cover"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
      {list.length > 1 && (
        <>
          <div className="absolute top-1.5 left-2 right-2 flex gap-1">
            {list.map((_, i) => (
              <span key={i} className={`h-[2px] flex-1 rounded-full ${i === idx ? 'bg-white/95' : 'bg-white/35'}`} />
            ))}
          </div>
          <button
            aria-label="Previous photo"
            className="absolute left-1 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/30 text-white backdrop-blur-sm flex items-center justify-center hover:bg-black/50"
            onClick={(e) => go(-1, e)}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            aria-label="Next photo"
            className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/30 text-white backdrop-blur-sm flex items-center justify-center hover:bg-black/50"
            onClick={(e) => go(1, e)}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </>
      )}
    </div>
  );
};


interface BrowseTableProps {
  /** Where auth redirects should return to (default /browse) */
  returnTo?: string;
  /** Adjusts for a host page that owns the bottom of the screen (the hub's
   *  chat dock) so the compare bar does not sit underneath it. */
  embedded?: boolean;
  /** A comparison started on another page and handed over (lib/chatHandoff):
   *  the panel reopens on these listings as soon as the table has them. */
  initialCompareIds?: string[];
  /** Tells the host a compare panel is on screen, so it doesn't move the pane
   *  out from under it - unmounting this table would close the panel. */
  onCompareOpenChange?: (open: boolean) => void;
}

export const BrowseTable = ({
  returnTo = '/browse',
  embedded = false,
  initialCompareIds,
  onCompareOpenChange,
}: BrowseTableProps) => {
  const navigate = useNavigate();

  // Filters. The table always opens on the full verified set - narrowing it is
  // the renter's move, and preference-shaped results are the AI tab's job.
  const [city, setCity] = useState('all');
  const [districts, setDistricts] = useState<string[]>([]);
  const [roomsFilter, setRoomsFilter] = useState('all');
  const [minBudget, setMinBudget] = useState('');
  const [maxBudget, setMaxBudget] = useState('');
  const [freshOnly, setFreshOnly] = useState(false);

  // City and budget are server-side filters (they change what gets fetched);
  // district, rooms and freshness are applied to the result below.
  const { rows, loading, error } = useBrowseListings({ city, minBudget, maxBudget });

  const changeCity = (c: string) => {
    setCity(c);
    setDistricts([]); // district list is city-specific
  };

  const toggleDistrict = (d: string) => {
    setDistricts((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));
  };

  // Sorting
  const [sortKey, setSortKey] = useState<SortKey>('last_verified_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Compare + fast-track + preview
  const [selected, setSelected] = useState<BrowseRow[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  /** Listings handed to the schedule modal - the compare selection, or one previewed listing */
  const [scheduleTargets, setScheduleTargets] = useState<BrowseRow[]>([]);
  // In-place chat: "Ask Hausto" opens the thread over browse, no navigation.
  const [preview, setPreview] = useState<BrowseRow | null>(null);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [liking, setLiking] = useState(false);
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const { user } = useAuth();
  const { createMatch } = useMatches();
  const { quota, refetchQuota } = useViewingQuota();

  // Saved vibe preferences (from the onboarding quiz) power the compare
  // dialog's match scores; absent for users who skipped the quiz. Read through
  // the shared hook so an edit re-scores the table without a reload.
  const { preferences: savedPreferences } = useUserPreferences();

  // Plain-language vibe match: overall score plus what specifically matched
  // on each dimension, shown inline (no popup).
  const vibeMatchOf = (r: BrowseRow) => {
    if (!savedPreferences) return null;
    try {
      const apartment = {
        id: r.id,
        images: r.images || [],
        title: r.title,
        location: r.location,
        price: r.price_vnd || 0,
        size: r.size || '',
        vibe: r.vibe || '',
        description: r.description || '',
        highlights: r.highlights || [],
        amenities: r.amenities || [],
        // Same shape the matches view consumes, so the Style group renders
        // from the AI analysis tags (vibe string is the scoring fallback).
        vibe_analysis: (r.style_tags && r.style_tags.length > 0) ? { styles: r.style_tags } : undefined,
        realtor: { id: '', name: '', phone: '', email: '' },
      } as Apartment;
      const score = calculateVibeScore(apartment, savedPreferences);
      const attrs = getVibeAttributeMatch(apartment, savedPreferences);
      return { score, attrs, rating: getVibeRatingLabel(score.overall) };
    } catch {
      return null;
    }
  };

  // Creates the match if the renter doesn't have one yet. Resolves true once a
  // match exists (new or pre-existing) so callers can carry on into the
  // conversation; ALREADY_MATCHED is a success here, not a failure.
  const ensureMatch = async (row: BrowseRow) => {
    try {
      if (row.source === 'hausto') {
        // Internal listing: match with its actual realtor
        const { data } = await supabase.functions.invoke('get-public-property', { body: { id: row.id } });
        const realtorId = data?.property?.realtor_id;
        if (!realtorId) throw new Error('Realtor not found');
        await createMatch(row.id, realtorId);
      } else {
        // External listing: Hausto Agent handles the conversation
        await createMatch(row.id, HAUSTO_AGENT_ID, 'external');
      }
    } catch (e) {
      if ((e as Error)?.message !== 'ALREADY_MATCHED') throw e;
    }
  };

  const handleLike = async (row: BrowseRow) => {
    if (!user) {
      navigate('/auth', { state: { returnTo } });
      return;
    }
    if (likedIds.has(row.id) || liking) return;
    setLiking(true);
    try {
      await ensureMatch(row);
      setLikedIds((cur) => new Set(cur).add(row.id));
      toast.success('Added to your matches', {
        description: 'Chat and schedule a viewing from the Matches tab.',
      });
    } catch (e) {
      console.error('Like failed:', e);
      toast.error('Could not save the like. Please try again.');
    } finally {
      setLiking(false);
    }
  };

  const openFastTrack = (targets: BrowseRow[]) => {
    if (targets.length === 0) return;
    if (!user) {
      navigate('/auth', { state: { returnTo } });
      return;
    }
    // Free tier gets one coordination on the house; after that (and after a
    // premium cycle runs out) the upgrade path takes over.
    if (!quota) {
      toast.info('Checking your viewing allowance - one moment.');
      return;
    }
    if (!quota.canBook) {
      if (quota.trialUsed) {
        setSubscriptionOpen(true);
      } else {
        toast.error('Viewing bookings used up for this cycle', {
          description: 'Upgrade or buy a viewing pack from your matches page to book more.',
        });
      }
      return;
    }
    setScheduleTargets(targets);
    setScheduleOpen(true);
  };

  const submitFastTrack = async (scheduleData: ViewingScheduleData) => {
    if (!user) return;
    try {
      // Browse requests have no chat conversation or matched realtor yet -
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
        const chosen = scheduleTargets.filter((r) => scheduleData.selectedPropertyIds.includes(r.id));
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
      setPreview(null);
      // Drop only what was actually booked so an in-progress compare survives a
      // single-listing request made from the preview card.
      setSelected((cur) => cur.filter((r) => !scheduleData.selectedPropertyIds.includes(r.id)));
      toast.success('Viewing request sent', {
        description: "We'll confirm availability with the agents and send you a schedule.",
      });
    } catch (e) {
      console.error('Fast-track request failed:', e);
      toast.error('Could not send the request. Please try again.');
    }
  };

  const filtered = useMemo(() => {
    let out = rows;
    if (districts.length > 0) {
      out = out.filter((r) => districts.some((d) => locationMatchesDistrict(r.location, d)));
    }
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
        const n = (r: BrowseRow) => (r.rooms || '').toLowerCase().includes('studio') ? 0 : (parseInt(r.rooms || '') || parseSizeNum(r.rooms) || 99);
        av = n(a); bv = n(b);
      } else {
        av = a.last_verified_at ? new Date(a.last_verified_at).getTime() : 0;
        bv = b.last_verified_at ? new Date(b.last_verified_at).getTime() : 0;
      }
      return (av - bv) * dir;
    });
  }, [rows, districts, roomsFilter, freshOnly, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'last_verified_at' ? 'desc' : 'asc'); }
  };

  const toggleSelect = (row: BrowseRow) => {
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

  // Opens the side-by-side panel AND starts the conversation about it: the
  // listings are pinned to the AI chat and the first question is asked, so the
  // renter lands in a thread they can keep pulling on rather than a dead end.
  const openCompare = () => {
    setCompareOpen(true);
    if (selected.length < 2) return;
    window.dispatchEvent(
      new CustomEvent<AssistantCompareDetail>(ASSISTANT_COMPARE_EVENT, {
        detail: {
          properties: selected.map((r) => ({ propertyId: r.id, title: r.title })),
          // Named in the message, not just pinned by id - see listSubjects.
          prompt: `Compare ${listSubjects(selected.map((r) => r.title))} for me - which fits me best, and what are the tradeoffs?`,
        },
      }),
    );
  };

  // A comparison carried over from /browse: rebuild the selection out of the
  // rows once they land, and open the panel on it. Once only - reopening it on
  // every refresh would fight the renter closing it.
  const carriedCompareRef = useRef(false);
  useEffect(() => {
    if (carriedCompareRef.current) return;
    if (!initialCompareIds?.length) return;
    const carried = initialCompareIds
      .map((id) => rows.find((r) => r.id === id))
      .filter((r): r is BrowseRow => !!r);
    // Rows stream in a page at a time, so hold until they are all here or the
    // fetch is done. Anything still missing then is outside what this table
    // holds, and below two listings there is nothing to compare.
    if (carried.length < initialCompareIds.length && loading) return;
    carriedCompareRef.current = true;
    if (carried.length < 2) return;
    setSelected(carried);
    setCompareOpen(true);
  }, [initialCompareIds, rows, loading]);

  // Mirrors up while the panel is open, and on the way out - a host left
  // holding a stale `true` would never switch panes again.
  useEffect(() => {
    onCompareOpenChange?.(compareOpen);
    return () => onCompareOpenChange?.(false);
  }, [compareOpen, onCompareOpenChange]);

  const compareFields: { label: string; get: (r: BrowseRow) => string }[] = [
    { label: 'Price', get: (r) => (r.price_usd ? `$${r.price_usd.toLocaleString()}/mo` : '-') },
    { label: 'Rooms', get: (r) => r.rooms || '-' },
    { label: 'Size', get: (r) => (r.size && !/not specified|n\/a|bed/i.test(r.size) ? r.size : '-') },
    { label: 'Verified live', get: (r) => verifiedLabel(r.last_verified_at) },
  ];


  return (
    <div>
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Select value={city} onValueChange={changeCity}>
          <SelectTrigger className="w-[180px] bg-background"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CITIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {city !== 'all' && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="bg-background font-normal">
                {districts.length === 0
                  ? 'All districts'
                  : districts.length <= 2
                    ? districts.join(', ')
                    : `${districts.length} districts`}
                <ChevronDown className="w-4 h-4 ml-2 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-3" align="start">
              <div className="flex flex-wrap gap-1.5 max-h-64 overflow-y-auto">
                {(CITY_DISTRICTS[city] || []).map((d) => {
                  const active = districts.includes(d);
                  return (
                    <button
                      key={d}
                      onClick={() => toggleDistrict(d)}
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
              {districts.length > 0 && (
                <button
                  className="mt-2 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                  onClick={() => setDistricts([])}
                >
                  <X className="w-3 h-3" /> Clear districts
                </button>
              )}
            </PopoverContent>
          </Popover>
        )}
        <Select value={roomsFilter} onValueChange={setRoomsFilter}>
          <SelectTrigger className="w-[150px] bg-background"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ROOM_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          <Input
            type="number"
            placeholder="Min $"
            value={minBudget}
            onChange={(e) => setMinBudget(e.target.value)}
            className="w-[90px] bg-background"
            aria-label="Minimum monthly budget in USD"
          />
          <span className="text-muted-foreground text-sm">-</span>
          <Input
            type="number"
            placeholder="Max $"
            value={maxBudget}
            onChange={(e) => setMaxBudget(e.target.value)}
            className="w-[90px] bg-background"
            aria-label="Maximum monthly budget in USD"
          />
        </div>
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


          {/* Full comparison table at every width — on phones it scrolls
              horizontally rather than dropping columns */}
          <div className="rounded-2xl border border-border bg-card/80 backdrop-blur-sm shadow-sm overflow-x-auto [scrollbar-width:thin]">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"><Scale className="w-3.5 h-3.5" /></TableHead>
                  <TableHead>Property</TableHead>
                  <TableHead>Location</TableHead>
                  <SortHeader label="Rooms" k="rooms" />
                  <SortHeader label="Size" k="size" />
                  <SortHeader label="Price" k="price_usd" />
                  <SortHeader label="Verified" k="last_verified_at" />
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => {
                  const fresh = daysAgo(r.last_verified_at);
                  return (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer"
                      onClick={() => setPreview(r)}
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
                              className="w-16 h-12 sm:w-14 sm:h-10 rounded object-cover flex-shrink-0"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                          )}
                          <div className="min-w-0">
                            <p className="font-medium text-sm line-clamp-1">{r.title}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[220px]">
                        <span className="line-clamp-1">{districtOf(r.location)}</span>
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{r.rooms || '-'}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {/* Source data sometimes puts room counts or "N/A" in size */}
                        {r.size && !/not specified|n\/a|bed/i.test(r.size) ? r.size : '-'}
                      </TableCell>
                      <TableCell className="text-sm font-medium whitespace-nowrap">
                        {r.price_usd ? `$${r.price_usd.toLocaleString()}` : '-'}
                        <span className="text-xs text-muted-foreground font-normal">/mo</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1.5 text-xs ${fresh !== null && fresh <= 7 ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                          {fresh !== null && fresh <= 7 && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                          {verifiedLabel(r.last_verified_at)}
                        </span>
                      </TableCell>
                      {/* Provenance only. The outbound link lives in the preview
                          modal, below the Hausto CTAs - a one-click exit on every
                          row hands the lead to the source before we've made the
                          case for booking through us. */}
                      <TableCell>
                        {(() => {
                          const info = r.source === 'hausto'
                            ? { name: 'Hausto', logo: '/logos/hausto-wordmark.svg' }
                            : getPropertySourceLogo(r.source_url || r.source);
                          return (
                            <span title={info.name} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                              <img loading="lazy"
                                src={info.logo}
                                alt={info.name}
                                className="h-6 w-auto max-w-[80px] rounded-sm object-contain flex-shrink-0"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                            </span>
                          );
                        })()}
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

      {/* Compare bar. Embedded on the hub, the chat dock owns the bottom of the
          screen below lg - so this sits above it rather than under it. */}
      {selected.length > 0 && (
        <div className={`fixed left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-full bg-foreground text-background px-5 py-2.5 shadow-lg ${
          embedded
            // Centred on the browse pane, not the viewport: at xl the chat rail
            // owns the right-hand side, so a viewport-centred bar drifts under it.
            ? `bottom-20 xl:bottom-6 ${HUB_PANE_CENTRED}`
            : 'bottom-4'
        }`}>
          <span className="text-sm">{selected.length} selected</span>
          <Button size="sm" variant="secondary" className="rounded-full h-7" disabled={selected.length < 2} onClick={openCompare}>
            Compare
          </Button>
          <Button size="sm" className="rounded-full h-7" onClick={() => openFastTrack(selected)}>
            <CalendarCheck className="w-3.5 h-3.5 mr-1.5" />
            Request viewings
          </Button>
          <button className="text-xs opacity-70 hover:opacity-100" onClick={() => setSelected([])}>Clear</button>
        </div>
      )}

      {/* In-place property preview: the platform's listing card with like, no
          page change. On the hub it is deliberately not modal - the whole point
          of the chat is being able to ask about the listing you are looking at,
          which a scrim and a focus trap would prevent. */}
      {(() => {
        // Derived outside the props so the dialog itself stays mounted while
        // it closes - conditionally rendering it cuts the exit animation.
        const previewScore = preview ? vibeMatchOf(preview) : undefined;
        const isHausto = preview?.source === 'hausto';
        const sourceName = !preview
          ? ''
          : isHausto
            ? 'Hausto'
            : getPropertySourceLogo(preview.source_url || preview.source).name;
        return (
          <ListingPreviewDialog
            open={!!preview}
            onOpenChange={(o) => { if (!o) setPreview(null); }}
            embedded={embedded}
            apartment={preview ? {
              id: preview.id,
              images: preview.images || [],
              title: preview.title,
              location: preview.location,
              price: preview.price_vnd || 0,
              size: preview.size,
              rooms: preview.rooms,
              vibe: preview.vibe,
              description: preview.description,
              highlights: preview.highlights,
              amenities: preview.amenities,
              last_verified_at: preview.last_verified_at,
              // Reconstruct the analysis the card reads: the style tags behind
              // its vibe badge, plus per-image analyses so it shows the detailed
              // highlight per photo, not just the vibe word.
              vibe_analysis: (preview.style_tags?.length || preview.image_highlights?.length)
                ? {
                    ...(preview.style_tags?.length ? { styles: preview.style_tags } : {}),
                    ...(preview.image_highlights?.length
                      ? { image_analyses: preview.image_highlights.map((h, i) => ({ image_index: i, image_highlight: h })) }
                      : {}),
                  }
                : undefined,
            } : null}
            vibeScore={previewScore?.score}
            vibeMatch={previewScore?.attrs}
            scoreContext="preferences"
            liked={!!preview && likedIds.has(preview.id)}
            onLike={preview ? () => handleLike(preview) : undefined}
            onSchedule={preview ? () => openFastTrack([preview]) : undefined}
            source={preview ? { name: sourceName, href: isHausto ? `/property/${preview.id}` : preview.source_url } : undefined}
          />
        );
      })()}

      <ViewingScheduleModal
        isOpen={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onSubmit={submitFastTrack}
        matchedProperties={scheduleTargets.map((r) => ({
          id: r.id, title: r.title, images: r.images,
          location: r.location, price: r.price_vnd || undefined,
        }))}
        initialSelectedIds={scheduleTargets.map((r) => r.id)}
        onPropertyClick={(id) => navigate(`/property/${id}`)}
      />

      {/* Softens the table behind the comparison without reaching the chat -
          the panel is not modal, so nothing else does it. */}
      <HubPanelScrim open={embedded && compareOpen} onDismiss={() => setCompareOpen(false)} />

      {/* Side-by-side facts only. Deciding between them is a conversation, and
          that conversation now belongs in the AI chat, where it keeps the
          listings pinned afterwards - see the Compare button above. */}
      <Dialog open={compareOpen} modal={!embedded} onOpenChange={setCompareOpen}>
        <DialogContent
          overlayClassName={embedded ? 'hidden' : undefined}
          // Reaching for the chat is not dismissing the comparison - see
          // ListingPreviewDialog.
          onInteractOutside={embedded ? (e) => e.preventDefault() : undefined}
          className={`overflow-y-auto ${
            embedded
              // Centred on the browse pane, not the viewport, capped to its
              // width, and held clear of the chat - the whole point of comparing
              // here is being able to ask about it while you read. Its own
              // max-height is left to HUB_PANEL_POSITION: a second one here beat
              // that by stylesheet order and covered the dock.
              ? `max-w-4xl ${HUB_PANEL_POSITION}`
              : 'max-w-4xl max-h-[90vh]'
          }`}
        >
          <DialogHeader><DialogTitle>Compare listings</DialogTitle></DialogHeader>
          {/* One card per listing: side by side on desktop, horizontal snap
              scroll on mobile so each card gets full width */}
          <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-1 [scrollbar-width:thin]">
            {selected.map((r, i) => {
              const score = vibeMatchOf(r);
              return (
                <div
                  key={r.id}
                  className="snap-start flex-shrink-0 w-[80vw] max-w-[280px] sm:w-auto sm:min-w-[220px] sm:flex-1 rounded-xl border border-border bg-card overflow-hidden flex flex-col"
                >
                  <CompareImageCarousel images={r.images || []} alt={r.title} />
                  <div className="p-3 flex flex-col gap-2 flex-1">
                    <button className="font-medium text-sm text-left hover:underline line-clamp-2" onClick={() => setPreview(r)}>
                      <span className="text-muted-foreground mr-1">{i + 1}.</span>{r.title}
                    </button>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <MapPin className="w-3 h-3 flex-shrink-0" />
                      <span className="line-clamp-1">{districtOf(r.location)}</span>
                    </p>

    {score && (
                      /* Same chip + popover as every other vibe badge on the platform */
                      <VibeMatchPopover vibeScore={score.score} vibeMatch={score.attrs} align="start">
                        <button
                          aria-label="View match scoring details"
                          className="inline-flex items-center gap-1.5 w-fit rounded-full bg-secondary px-2.5 py-1 hover:bg-secondary/70 transition-colors"
                        >
                          <span className={`w-2 h-2 rounded-full ${RATING_DOT[score.rating] || 'bg-gray-300'}`} />
                          <span className="font-mono text-[10px] tracking-[0.14em] uppercase">{score.rating} match</span>
                          <span className="text-[11px] font-medium text-muted-foreground">· {score.score.overall}%</span>
                        </button>
                      </VibeMatchPopover>
                    )}

                    <dl className="text-xs space-y-1 mt-1">
                      {compareFields.map((f) => (
                        <div key={f.label} className="flex justify-between gap-2">
                          <dt className="text-muted-foreground">{f.label}</dt>
                          <dd className="font-medium text-right">{f.get(r)}</dd>
                        </div>
                      ))}
                    </dl>

                    {(r.amenities && r.amenities.length > 0) && (
                      <div className="flex flex-wrap gap-1 mt-auto pt-2 border-t border-border">
                        {r.amenities.slice(0, 8).map((a) => (
                          <span key={a} className="rounded-full bg-secondary px-2 py-0.5 text-[10px]">{a}</span>
                        ))}
                        {r.amenities.length > 8 && (
                          <span className="text-[10px] text-muted-foreground self-center">+{r.amenities.length - 8}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

        </DialogContent>
      </Dialog>

      {/* Opens over browse from the preview card's "Ask Hausto" - the renter
          keeps their filters, scroll position and shortlist. */}

      <SubscriptionModal
        isOpen={subscriptionOpen}
        onClose={() => setSubscriptionOpen(false)}
        reason={quota?.trialUsed ? 'viewings' : undefined}
      />
    </div>
  );
};
