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
import { ArrowDown, ArrowUp, ArrowUpDown, CalendarCheck, ChevronDown, Check, ChevronLeft, ChevronRight, Loader2, MapPin, Scale, Sparkles, X } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useMatches } from '@/hooks/useMatches';
import { useDirectMessages } from '@/hooks/useDirectMessages';
import { useSubscription } from '@/hooks/useSubscription';
import { useViewingQuota, INCLUDED_VIEWINGS_PER_CYCLE } from '@/hooks/useViewingQuota';
import { ViewingScheduleModal, ViewingScheduleData } from '@/components/ViewingScheduleModal';
import { EditorialPropertyCard } from '@/components/EditorialPropertyCard';
import { VibeMatchPopover } from '@/components/VibeMatchPopover';
import { SubscriptionModal } from '@/components/SubscriptionModal';
import { HaustoChat } from '@/components/HaustoChat';
import { HAUSTO_AGENT_ID } from '@/constants/haustoAgent';
import { getPropertySourceLogo } from '@/utils/propertySourceLogos';
import { calculateVibeScore, getVibeAttributeMatch } from '@/utils/vibeScoring';
import { getVibeRatingLabel } from '@/utils/vibeRating';
import type { Apartment, UserPreferences } from '@/types';

// The verified-listings table. Public data from public-property-search (no
// contact details); rendered standalone at /browse and embedded as the
// Browse view inside Discover.
const SEARCH_URL = 'https://gbgrwjdmytaksrztcyzs.supabase.co/functions/v1/public-property-search';
const PAGE_SIZE = 50; // API max per request
const MAX_ROWS = 1000; // safety cap; paging stops when the API runs dry

export type BrowseRow = {
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
  highlights?: string[];
  amenities?: string[];
  /** vibe_analysis.styles from the AI analysis - drives the Style match group */
  style_tags?: string[];
  /** Per-image AI highlight strings, indexed to images - the detailed captions */
  image_highlights?: string[];
  description?: string | null;
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

// Renter-facing district lists per city (matches CityDistrictSelector naming)
const CITY_DISTRICTS: Record<string, string[]> = {
  hcmc: [
    'District 1', 'District 2', 'District 3', 'District 4', 'District 5',
    'District 6', 'District 7', 'District 8', 'District 10', 'District 11',
    'Binh Thanh', 'Tan Binh', 'Tan Phu', 'Phu Nhuan', 'Go Vap', 'Thu Duc', 'Binh Tan',
  ],
  hanoi: ['Hoan Kiem', 'Ba Dinh', 'Cau Giay', 'Tay Ho', 'Dong Da', 'Hai Ba Trung', 'Long Bien', 'Nam Tu Liem'],
  danang: ['Hai Chau', 'Son Tra', 'Ngu Hanh Son', 'Thanh Khe', 'Lien Chieu', 'Cam Le'],
};

const stripDiacritics = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');

// Listings mix Vietnamese ("Quan Tan Binh") and English ("District 2") location
// strings, so district matching is diacritic-stripped with a Quan/District alias.
const locationMatchesDistrict = (location: string, district: string): boolean => {
  const loc = stripDiacritics(location).toLowerCase();
  const d = stripDiacritics(district).toLowerCase();
  if (loc.includes(d)) return true;
  const numbered = d.match(/^district (\d+)$/);
  if (numbered) return new RegExp(`quan ${numbered[1]}(?!\\d)`).test(loc);
  return false;
};

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

const districtOf = (location: string): string => {
  const parts = (location || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return location;
  return parts.slice(0, -1).slice(-2).join(', ');
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

// The model is told to write plain text, but small models still slip in
// **bold** and "### " headings - render those rather than leaking the syntax.
const renderInline = (s: string) =>
  s.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part));

const AiText = ({ text }: { text: string }) => (
  <div className="space-y-1.5">
    {text.split('\n').map((raw, i) => {
      const line = raw.replace(/^\s*#{1,6}\s+/, '').trimEnd();
      if (!line.trim()) return null;
      const isBullet = /^\s*[-*•]\s+/.test(line);
      const content = line.replace(/^\s*[-*•]\s+/, '');
      return isBullet ? (
        <div key={i} className="flex gap-1.5">
          <span aria-hidden="true" className="flex-shrink-0 text-muted-foreground">-</span>
          <span>{renderInline(content)}</span>
        </div>
      ) : (
        <p key={i}>{renderInline(content)}</p>
      );
    })}
  </div>
);

type CompareChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  /** Suggested next questions, returned with assistant replies */
  followups?: string[];
};

const COMPARE_STARTERS = ['Which is the best value?', 'Which fits my preferences best?', 'What are the tradeoffs?'];

// Shared by the opening starters and the per-reply follow-up suggestions.
const SuggestionChip = ({ question, disabled, onAsk }: { question: string; disabled: boolean; onAsk: (q: string) => void }) => (
  <button
    className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-left text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors disabled:opacity-50"
    disabled={disabled}
    onClick={() => onAsk(question)}
  >
    {question}
  </button>
);

interface BrowseTableProps {
  /** Where auth redirects should return to (default /browse) */
  returnTo?: string;
}

export const BrowseTable = ({ returnTo = '/browse' }: BrowseTableProps) => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<BrowseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [city, setCity] = useState('all');
  const [districts, setDistricts] = useState<string[]>([]);
  const [roomsFilter, setRoomsFilter] = useState('all');
  const [minBudget, setMinBudget] = useState('');
  const [maxBudget, setMaxBudget] = useState('');
  const [freshOnly, setFreshOnly] = useState(false);

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
  const [chatOpen, setChatOpen] = useState(false);
  const [chatConversationId, setChatConversationId] = useState<string | null>(null);
  const [chatPropertyId, setChatPropertyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<BrowseRow | null>(null);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [liking, setLiking] = useState(false);
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const { user } = useAuth();
  const { createMatch } = useMatches();
  const { getOrCreateConversation, setCurrentConversationId } = useDirectMessages();
  const { subscribed } = useSubscription();
  const { quota, refetchQuota } = useViewingQuota();

  // Saved vibe preferences (from the onboarding quiz) power the compare
  // dialog's match scores; absent for users who skipped the quiz.
  const savedPreferences = useMemo<UserPreferences | null>(() => {
    if (!user) return null;
    try {
      const raw = localStorage.getItem(`userPreferences_${user.id}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, [user]);

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

  // Free intent-capture path off the preview card: match the listing and open
  // the conversation right here, so the renter never leaves browse. Mirrors
  // MatchesView's "Chat" flow - match, resolve the conversation, tag the property.
  const handleAskHausto = async (row: BrowseRow) => {
    if (!user) {
      navigate('/auth', { state: { returnTo } });
      return;
    }
    if (liking) return;
    setLiking(true);
    try {
      await ensureMatch(row);
      setLikedIds((cur) => new Set(cur).add(row.id));

      // External listings talk to the Hausto Agent; internal ones to the realtor.
      let realtorId: string = HAUSTO_AGENT_ID;
      if (row.source === 'hausto') {
        const { data } = await supabase.functions.invoke('get-public-property', { body: { id: row.id } });
        realtorId = data?.property?.realtor_id || HAUSTO_AGENT_ID;
      }
      const conversationId = await getOrCreateConversation(user.id, realtorId);
      if (!conversationId) throw new Error('Could not open the conversation');

      setCurrentConversationId(conversationId);
      setChatConversationId(conversationId);
      setChatPropertyId(row.id);
      setPreview(null);
      setChatOpen(true);
    } catch (e) {
      console.error('Ask Hausto failed:', e);
      toast.error('Could not start the conversation. Please try again.');
    } finally {
      setLiking(false);
    }
  };

  // Targets are either the compare selection or the single previewed listing.
  const openFastTrack = (targets: BrowseRow[]) => {
    if (targets.length === 0) return;
    if (!user) {
      navigate('/auth', { state: { returnTo } });
      return;
    }
    // Fast-Track coordination is a premium feature: free tier sees the upgrade modal
    if (!subscribed) {
      setSubscriptionOpen(true);
      return;
    }
    if (quota && !quota.canBook) {
      toast.error('Viewing bookings used up for this cycle', {
        description: 'Upgrade or purchase the unlimited add-on from your matches page to book more.',
      });
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

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      setRows([]);
      const collected: BrowseRow[] = [];
      try {
        const params = new URLSearchParams();
        if (city !== 'all') params.set('city', city);
        if (minBudget && Number(minBudget) > 0) params.set('min_budget', minBudget);
        if (maxBudget && Number(maxBudget) > 0) params.set('max_budget', maxBudget);
        params.set('limit', String(PAGE_SIZE));
        // Page until the API runs dry so the table holds ALL listings. That's up
        // to 20 serial requests, so each page is painted as it lands rather than
        // holding the whole table behind one spinner.
        for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
          params.set('offset', String(offset));
          const res = await fetch(`${SEARCH_URL}?${params}`);
          if (!res.ok) throw new Error(`Search failed (${res.status})`);
          const data = await res.json();
          const page: BrowseRow[] = data.results || [];
          collected.push(...page);
          if (cancelled) return;
          setRows([...collected]);
          setLoading(false);
          if (page.length < PAGE_SIZE) break;
        }
      } catch (e) {
        // A later page failing shouldn't blank out rows already on screen -
        // only surface the error state when we got nothing at all.
        if (!cancelled && collected.length === 0) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [city, minBudget, maxBudget]);

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

  const compareFields: { label: string; get: (r: BrowseRow) => string }[] = [
    { label: 'Price', get: (r) => (r.price_usd ? `$${r.price_usd.toLocaleString()}/mo` : '-') },
    { label: 'Rooms', get: (r) => r.rooms || '-' },
    { label: 'Size', get: (r) => (r.size && !/not specified|n\/a|bed/i.test(r.size) ? r.size : '-') },
    { label: 'Verified live', get: (r) => verifiedLabel(r.last_verified_at) },
  ];

  // Ask-AI thread inside the compare dialog - a back-and-forth, not one shot.
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiMessages, setAiMessages] = useState<CompareChatMessage[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const aiThreadEndRef = useRef<HTMLDivElement>(null);

  // Option numbers in the thread refer to the current selection, so changing
  // what's being compared invalidates the conversation.
  const selectedKey = selected.map((r) => r.id).join(',');
  useEffect(() => {
    setAiMessages([]);
  }, [selectedKey]);

  useEffect(() => {
    aiThreadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [aiMessages, aiLoading]);

  const askCompareAI = async (q?: string) => {
    const question = (q ?? aiQuestion).trim();
    if (!question || aiLoading || selected.length < 2) return;
    const history = aiMessages;
    setAiMessages([...history, { role: 'user', content: question }]);
    setAiQuestion('');
    setAiLoading(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('compare-listings-ai', {
        body: { question, listings: selected, preferences: savedPreferences || undefined, history },
      });
      if (fnError) throw fnError;
      setAiMessages((cur) => [...cur, {
        role: 'assistant',
        content: data?.answer || 'Sorry, I could not analyze these listings.',
        followups: Array.isArray(data?.followups) ? data.followups : [],
      }]);
    } catch (e) {
      console.error('Compare AI failed:', e);
      setAiMessages((cur) => [...cur, { role: 'assistant', content: 'Something went wrong - please try again.' }]);
    } finally {
      setAiLoading(false);
    }
  };

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

      {/* Compare bar */}
      {selected.length > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-full bg-foreground text-background px-5 py-2.5 shadow-lg">
          <span className="text-sm">{selected.length} selected</span>
          <Button size="sm" variant="secondary" className="rounded-full h-7" disabled={selected.length < 2} onClick={() => setCompareOpen(true)}>
            Compare
          </Button>
          <Button size="sm" className="rounded-full h-7" onClick={() => openFastTrack(selected)}>
            <CalendarCheck className="w-3.5 h-3.5 mr-1.5" />
            Request viewings
          </Button>
          <button className="text-xs opacity-70 hover:opacity-100" onClick={() => setSelected([])}>Clear</button>
        </div>
      )}

      {/* In-place property preview: full editorial card with like, no page change.
          4:3 here on desktop only — the wide dialog gives the photo room. The
          rest of the app, and this modal on phones, keep the portrait card: at
          a phone's width 4:3 is short enough that the text crowds the chips. */}
      <Dialog open={!!preview} onOpenChange={(o) => { if (!o) setPreview(null); }}>
        {/* Close lives inline with share/like via the card's onClose - hide the default dialog X */}
        {/* max-w-md matches the swipe and matches views, so the card is the
            same size everywhere it appears. Card plus booking panel is taller
            than a phone screen, so the modal is bound to the viewport and
            scrolls - dvh, not vh, so a collapsing address bar cannot hide the
            bottom of it. */}
        <DialogContent className="max-w-md max-h-[92dvh] overflow-y-auto overscroll-contain p-0 gap-0 bg-transparent border-0 shadow-none [&>button]:hidden">
          {preview && (() => {
            const previewScore = vibeMatchOf(preview);
            const isHausto = preview.source === 'hausto';
            const sourceInfo = isHausto
              ? { name: 'Hausto', logo: '/logos/hausto-wordmark.svg' }
              : getPropertySourceLogo(preview.source_url || preview.source);
            const originalHref = isHausto ? `/property/${preview.id}` : preview.source_url;
            return (
              <div>
                <EditorialPropertyCard
                  apartment={{
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
                    // Reconstruct per-image analyses so the card shows the
                    // detailed highlight per photo, not just the vibe word.
                    vibe_analysis: (preview.image_highlights && preview.image_highlights.length > 0)
                      ? { image_analyses: preview.image_highlights.map((h, i) => ({ image_index: i, image_highlight: h })) }
                      : undefined,
                  }}
                  vibeScore={previewScore?.score}
                  vibeMatch={previewScore?.attrs}
                  scoreContext="preferences"
                  /* No aspect override: the card keeps its default editorial
                     portrait, the same size it has in swipe and matches. */
                  liked={likedIds.has(preview.id)}
                  onLike={() => handleLike(preview)}
                  onClose={() => setPreview(null)}
                  onContact={() => handleAskHausto(preview)}
                  contactLabel="Ask Hausto"
                  onSchedule={() => openFastTrack([preview])}
                  scheduleLabel="Book viewing"
                />

                {/* Why book through Hausto instead of calling the source number.
                    The CTAs above are the only forward path from this modal, so
                    the offer has to be legible before the paywall, not after. */}
                <div className="mt-2 rounded-2xl border border-border bg-background/95 backdrop-blur-sm px-4 py-3">
                  <p className="text-sm font-medium">
                    Let Hausto book the viewing for you - hassle-free, no language barriers, skip the endless back-and-forth.
                  </p>
                  <ul className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-3">
                    {[
                      'We confirm it is still available before you travel',
                      'An English-speaking coordinator handles the agent',
                      'Book several viewings into one trip',
                    ].map((point) => (
                      <li key={point} className="flex items-start gap-1.5">
                        <Check className="w-3.5 h-3.5 mt-px flex-shrink-0 text-emerald-600" />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-border pt-2.5">
                    <span className="text-xs text-muted-foreground">
                      {subscribed
                        ? quota?.unlimited
                          ? 'Unlimited viewings active this month'
                          : `${quota?.remaining ?? INCLUDED_VIEWINGS_PER_CYCLE} viewing requests left this cycle`
                        : 'Viewing coordination is a Premium feature'}
                    </span>
                    {originalHref && (
                      <a
                        href={originalHref}
                        target={isHausto ? undefined : '_blank'}
                        rel={isHausto ? undefined : 'noopener noreferrer'}
                        className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground whitespace-nowrap"
                      >
                        View original on {sourceInfo.name}
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

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

      <Dialog open={compareOpen} onOpenChange={(o) => { setCompareOpen(o); if (!o) { setAiMessages([]); setAiQuestion(''); } }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
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

          {/* Ask AI to help decide */}
          <div className="border-t pt-4 mt-2">
            <p className="text-sm font-medium mb-2 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-primary" />
              Ask AI to help you decide
            </p>
            {/* Starters double as the empty state; once the thread is going they
                make way for it so the conversation stays the focus. */}
            {aiMessages.length === 0 ? (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {COMPARE_STARTERS.map((q) => (
                  <SuggestionChip key={q} question={q} disabled={aiLoading} onAsk={askCompareAI} />
                ))}
              </div>
            ) : (
              <div className="mb-2 max-h-[40vh] overflow-y-auto pr-1 space-y-2 [scrollbar-width:thin]">
                {aiMessages.map((m, i) => {
                  if (m.role === 'user') {
                    return (
                      <div key={i} className="flex justify-end">
                        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
                          {m.content}
                        </div>
                      </div>
                    );
                  }
                  // Chips hang off the newest reply only - keeping them on older
                  // turns would offer questions the thread has already moved past.
                  const isLatest = i === aiMessages.length - 1;
                  return (
                    <div key={i} className="flex flex-col items-start gap-1.5">
                      <div className="max-w-[90%] rounded-2xl rounded-bl-sm bg-secondary/60 px-3 py-2 text-sm">
                        <AiText text={m.content} />
                      </div>
                      {isLatest && !aiLoading && (m.followups?.length ?? 0) > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {m.followups!.map((q) => (
                            <SuggestionChip key={q} question={q} disabled={aiLoading} onAsk={askCompareAI} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {aiLoading && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl rounded-bl-sm bg-secondary/60 px-3 py-2">
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    </div>
                  </div>
                )}
                <div ref={aiThreadEndRef} />
              </div>
            )}
            <div className="flex gap-2">
              <Input
                value={aiQuestion}
                onChange={(e) => setAiQuestion(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') askCompareAI(); }}
                placeholder={aiMessages.length === 0 ? 'e.g. Which one is best for working from home?' : 'Ask a follow-up...'}
                className="bg-background"
              />
              <Button onClick={() => askCompareAI()} disabled={aiLoading || !aiQuestion.trim()}>
                {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Ask'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Opens over browse from the preview card's "Ask Hausto" - the renter
          keeps their filters, scroll position and shortlist. */}
      <HaustoChat
        isOpen={chatOpen}
        onClose={() => {
          setChatOpen(false);
          setChatConversationId(null);
          setChatPropertyId(null);
        }}
        userPreferences={savedPreferences ?? undefined}
        userType="renter"
        initialMatchId={chatConversationId}
        initialPropertyId={chatPropertyId}
      />

      <SubscriptionModal isOpen={subscriptionOpen} onClose={() => setSubscriptionOpen(false)} />
    </div>
  );
};
