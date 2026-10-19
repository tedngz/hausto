import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { PROPERTY_PUBLIC_COLUMNS } from '@/lib/propertyColumns';
import { translateLocationToEnglish } from '@/utils/locationTranslation';
import { getPropertySourceLogo } from '@/utils/propertySourceLogos';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Send, MapPin, Home, DollarSign, Upload, X, MessageSquare, Plus, History, PlaneTakeoff, Heart, CalendarCheck, Search, MessageCircle, Check } from 'lucide-react';
import { PropertyAmenities } from '@/components/PropertyAmenities';
import { useNavigate } from 'react-router-dom';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useToast } from '@/components/ui/use-toast';
import { ListingPreviewDialog } from '@/components/ListingPreviewDialog';
import { VibeScore } from '@/components/VibeScore';
import { HighlightTags } from '@/components/HighlightTags';
import { UserPreferences } from '@/types';
import { useHomeAI } from '@/hooks/useHomeAI';
import { useAuth } from '@/hooks/useAuth';
import { useMatches } from '@/hooks/useMatches';
import { FREE_TIER_LIMITS, useUsageTracking } from '@/hooks/useUsageTracking';
import { supabase } from '@/integrations/supabase/client';
import { invokeFunction } from '@/integrations/supabase/functions-client';
import { RequestViewingModal, type RequestSeed } from '@/components/RequestViewingModal';
import { MAX_ITEMS } from '../../supabase/functions/_shared/viewing/intake.ts';
import { setChatHandoff } from '@/lib/chatHandoff';
import { DEEP_SCAN_EVENT, type DeepScanDetail } from '@/lib/deepScanEvents';
import { SubscriptionModal } from '@/components/SubscriptionModal';
import { AIBlocks } from '@/components/ai-blocks/AIBlocks';
import { EditorialPropertyCard } from '@/components/EditorialPropertyCard';
import { DeepVibeAnalysis } from '@/components/DeepVibeAnalysis';
import { ASSISTANT_COMPARE_EVENT, ASSISTANT_OPEN_EVENT, type AssistantCompareDetail, type AssistantOpenDetail } from '@/lib/assistantEvents';
interface PropertyMatch {
  id: string;
  title: string;
  location: string;
  price: number;
  size: string;
  vibe: string;
  description: string;
  highlights: string[];
  images: string[];
  matchScore: number;
  matchReason: string;
  realtor_id?: string;
  vibe_analysis?: any;
  amenities?: string[];
  rooms?: string;
  property_source_link?: string;
  sourceProviderName?: string;
  sourceProviderPhone?: string;
  // External marketplace properties
  isExternal?: boolean;
  source?: 'batdongsan' | 'nhatot' | 'airbnb' | null;
  sourceUrl?: string | null;
  // Cache metadata
  cached?: boolean;
  crawledAt?: string;
}
/**
 * Blocks that read after a reply's listings rather than before them: the
 * follow-up chips, and Search for me under a search that found little.
 */
const BELOW_RESULTS = new Set(['followups', 'search_for_me']);

interface SearchResult {
  results: PropertyMatch[];
  summary: string;
  totalMatches: number;
  blocks?: import('@/components/ai-blocks/AIBlocks').AIBlock[];
}
/**
 * Assistant replies arrive as text, as JSON, or as JSON wrapped in
 * `{ response: "<json string>" }` depending on which model answered - so every
 * reply gets pulled apart the same way before it is rendered.
 *
 * Lifted out of the render so the hub can also parse the thread up front and
 * decide which reply's listings belong in the main pane.
 */
const parseAssistantMessage = (
  content: string,
): { searchResults: SearchResult | null; displayContent: string } => {
  const asResults = (o: any): SearchResult | null => {
    if (o?.results && Array.isArray(o.results)) return o as SearchResult;
    if (o?.blocks && Array.isArray(o.blocks)) {
      return { results: [], summary: o.summary || '', totalMatches: 0, blocks: o.blocks };
    }
    return null;
  };

  try {
    const parsed = JSON.parse(content);
    if (parsed.response && typeof parsed.response === 'string') {
      try {
        const inner = asResults(JSON.parse(parsed.response));
        if (inner) return { searchResults: inner, displayContent: content };
      } catch {
        // inner payload is prose, not JSON
      }
      return { searchResults: null, displayContent: parsed.response };
    }
    const direct = asResults(parsed);
    if (direct) return { searchResults: direct, displayContent: content };
  } catch {
    // Not JSON at all - usually plain prose, but small models sometimes emit a
    // JSON payload with commentary wrapped around it.
    if (/\{"results":|"summary":|"blocks":/.test(content)) {
      const match = content.match(/\{[\s\S]*"(results|blocks)"[\s\S]*\}/);
      if (match) {
        try {
          const extracted = asResults(JSON.parse(match[0]));
          if (extracted) return { searchResults: extracted, displayContent: content };
        } catch {
          // fall through to the apology below
        }
      }
      return {
        searchResults: null,
        displayContent: 'I found some properties that match your preferences! Let me show you the results.',
      };
    }
  }
  return { searchResults: null, displayContent: content };
};

// Free searches a signed-out visitor has used today. Kept next to the parser
// rather than inside the component so the initial state can read it directly.
const ANON_SEARCHES_KEY = 'haustoAnonSearches';

const today = () => new Date().toISOString().split('T')[0];

const readAnonSearchCount = (): number => {
  try {
    const raw = localStorage.getItem(ANON_SEARCHES_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { date?: string; count?: number };
    // Yesterday's tally is not today's problem - matches the server's daily key.
    return parsed.date === today() ? Number(parsed.count) || 0 : 0;
  } catch {
    return 0;
  }
};

const writeAnonSearchCount = (count: number) => {
  try {
    localStorage.setItem(ANON_SEARCHES_KEY, JSON.stringify({ date: today(), count }));
  } catch {
    // Private mode: the in-memory count still holds for this session.
  }
};

interface HomeAIProps {
  userPreferences?: UserPreferences;
  /** When provided, HomeAI auto-sends this as the first message once (used for the
   *  quiz → AI-search handoff, and for the landing page's). Cleared by the
   *  parent after it fires. */
  initialQuery?: string;
  /** Reference images that came with `initialQuery`, sent alongside it. */
  initialImages?: File[];
  /** Listings pinned before the conversation's first message - what a sparkle
   *  fired off the hub hands over (see components/AssistantHandoff). */
  initialSubjects?: AssistantOpenDetail[];
  /** A Deep Scan asked for from a card elsewhere, read here on arrival. */
  initialDeepScan?: DeepScanDetail;
  onInitialQueryConsumed?: () => void;
  /** 'page' is the full-width Discover view; 'rail' fills a narrow docked
   *  column on the hub - no card chrome, thread scrolls, composer pinned. */
  variant?: 'page' | 'rail';
  /** When set (rail only), listing results render into this node instead of
   *  inside the chat thread, so they get the main pane's width. */
  resultsPortal?: HTMLElement | null;
  /** Fires with how many listings are currently on show in the portal. */
  onResultsCountChange?: (count: number) => void;
  /** When set (rail only), the history and new-chat controls render into this
   *  node instead of taking a row of their own above the thread - the hub puts
   *  them on the same line as the "Hausto Agent" heading. */
  headerPortal?: HTMLElement | null;
  /** Makes this composer a doorway rather than a chat: the first message is
   *  parked (see lib/chatHandoff) and the renter is sent to /hub, whose chat
   *  sends it and owns the conversation. What the landing page hero uses -
   *  answering on `/` left the renter reading results in a page with nowhere
   *  to take them. */
  handoffToHub?: boolean;
  /** Listings to pin on the far side of a `handoffToHub` message, so a chat
   *  opened from a listing page arrives at the hub already about it. */
  handoffSubjects?: AssistantOpenDetail[];
}
export const HomeAI = ({
  userPreferences,
  initialQuery,
  initialImages,
  initialSubjects,
  initialDeepScan,
  onInitialQueryConsumed,
  variant = 'page',
  resultsPortal,
  onResultsCountChange,
  headerPortal,
  handoffToHub = false,
  handoffSubjects
}: HomeAIProps) => {
  const isRail = variant === 'rail';
  // True when listings belong in the main pane rather than in the thread.
  const hoistResults = isRail && !!resultsPortal;
  // Which reply's listings the main pane is showing. Follows the newest reply
  // that returned any, but an older one can be brought back from the thread.
  const [activeResultsIdx, setActiveResultsIdx] = useState<number | null>(null);
  // Listings pinned to the conversation. Seeded by a property card's sparkle -
  // the event when it was fired on this page, `initialSubjects` when it was
  // fired on another one and handed over - and editable here from the renter's
  // matches, so support can be asked about one place or several without
  // leaving the chat.
  const [subjects, setSubjects] = useState<AssistantOpenDetail[]>(initialSubjects ?? []);
  const [isSubjectPickerOpen, setIsSubjectPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<PropertyMatch | null>(null);
  const [analysisProperty, setAnalysisProperty] = useState<PropertyMatch | null>(null);
  // The scan a renter has actually asked for, which is the only one that reads
  // itself on arrival. Opening a listing still pins its offer, but does not
  // spend the scan for them.
  const [scanRequest, setScanRequest] = useState<DeepScanDetail | null>(initialDeepScan ?? null);
  const [showPropertyModal, setShowPropertyModal] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<File[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [likedProperties, setLikedProperties] = useState<Set<string>>(new Set());
  // The places handed to the request modal: the liked ones from the banner,
  // or one listing from its preview. Kept apart from the preview so it
  // outlives it - the renter can close the preview behind the modal.
  const [requestSeeds, setRequestSeeds] = useState<RequestSeed[] | null>(null);
  const [isFastTrackBannerDismissed, setIsFastTrackBannerDismissed] = useState(false);
  const [isSubscriptionModalOpen, setIsSubscriptionModalOpen] = useState(false);
  const [tempUserMessage, setTempUserMessage] = useState<string | null>(null);
  const [tempUserMessageForLoggedIn, setTempUserMessageForLoggedIn] = useState<string | null>(null);
  const [tempUserImages, setTempUserImages] = useState<string[]>([]);
  const [typedPlaceholder, setTypedPlaceholder] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  // Anonymous users get a few free searches before we ask them to sign up.
  // Follow-ups (chip taps) don't count against this so a conversation can breathe.
  const ANON_SEARCH_LIMIT = 3;
  // Persisted for the day, not just the session: as component state a reload
  // handed out three more. The server caps per IP as well (chat-ai), so this is
  // about the wall being honest rather than about enforcement.
  const [anonSearchCount, setAnonSearchCount] = useState(() => readAnonSearchCount());
  const [wantsNewChat, setWantsNewChat] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const initialQuerySentRef = useRef(false);
  const navigate = useNavigate();
  const {
    formatPrice
  } = useCurrency();
  const {
    toast
  } = useToast();
  const {
    user,
    loading: authLoading
  } = useAuth();
  // Derived here (not with the useState above) so it reads `user` after useAuth runs.
  const anonLimitReached = !user && anonSearchCount >= ANON_SEARCH_LIMIT;
  const {
    createMatch,
    renterMatches
  } = useMatches();
  const {
    canPerformAction,
    updateUsage,
    refetchUsage
  } = useUsageTracking();

  // Use the proper chat hook for database-backed conversations
  const {
    conversations,
    messages,
    currentConversationId,
    setCurrentConversationId,
    sendMessage,
    sendMessageWithoutConversation,
    startFreshChat,
    isSendingMessage
  } = useHomeAI();

  // Every assistant reply, pulled apart once per change rather than on each
  // render - the thread, the main pane and the tab count all read from this.
  const parsedMessages = useMemo(
    () => messages.map((m) => (m.role === 'user' ? null : parseAssistantMessage(m.content))),
    [messages],
  );

  // Follow the newest reply that actually returned listings.
  const latestResultsIdx = useMemo(() => {
    for (let i = parsedMessages.length - 1; i >= 0; i -= 1) {
      if ((parsedMessages[i]?.searchResults?.results.length ?? 0) > 0) return i;
    }
    return null;
  }, [parsedMessages]);

  useEffect(() => {
    setActiveResultsIdx(latestResultsIdx);
  }, [latestResultsIdx]);

  // Signed-in threads come from the DB; a signed-out visitor's one-shot search
  // lives in local state instead. Both feed the main pane the same way.
  const activeResults = user
    ? (activeResultsIdx !== null ? parsedMessages[activeResultsIdx]?.searchResults ?? null : null)
    : searchResults;

  // A property card's sparkle fires this from anywhere on the page. In the rail
  // it pins the listing rather than opening a second chat - which is the whole
  // point of there being one chat now.
  useEffect(() => {
    if (!isRail) return;
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<AssistantOpenDetail>).detail;
      if (!detail?.propertyId) return;
      setSubjects((prev) =>
        prev.some((s) => s.propertyId === detail.propertyId) ? prev : [...prev, detail],
      );
      setIsSubjectPickerOpen(false);
    };
    window.addEventListener(ASSISTANT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(ASSISTANT_OPEN_EVENT, onOpen);
  }, [isRail]);

  // The browse table's Compare button: pin the shortlist and ask about it in
  // one go. The ids go straight into the send rather than via state, so there
  // is no render to wait for between pinning and asking.
  const handleSearchRef = useRef<typeof handleSearch | null>(null);
  useEffect(() => {
    if (!isRail) return;
    const onCompare = (event: Event) => {
      const detail = (event as CustomEvent<AssistantCompareDetail>).detail;
      if (!detail?.properties?.length) return;
      setSubjects(detail.properties);
      setIsSubjectPickerOpen(false);
      handleSearchRef.current?.(detail.prompt, {
        subjectIds: detail.properties.map(p => p.propertyId).filter((id): id is string => !!id),
      });
    };
    window.addEventListener(ASSISTANT_COMPARE_EVENT, onCompare);
    return () => window.removeEventListener(ASSISTANT_COMPARE_EVENT, onCompare);
  }, [isRail]);

  // The renter's matches, as pickable subjects.
  const subjectOptions = (renterMatches || [])
    .filter((m) => m.properties?.id)
    .map((m) => ({
      propertyId: m.properties!.id,
      title: m.properties!.title,
      location: m.properties!.location,
      image: m.properties!.images?.[0],
    }));

  const toggleSubject = (option: { propertyId: string; title: string }) => {
    setSubjects((prev) =>
      prev.some((s) => s.propertyId === option.propertyId)
        ? prev.filter((s) => s.propertyId !== option.propertyId)
        : [...prev, { propertyId: option.propertyId, title: option.title }],
    );
    // One pick, one decision: the list closes behind it rather than staying
    // open over the thread. Asking about a second listing is what the chip -
    // now reading "Add" - is for, and that is the renter's move to make.
    setIsSubjectPickerOpen(false);
  };

  // Anywhere else, or Escape: the picker is a menu, and a menu that only the
  // chip can dismiss sits on top of the reply the renter is trying to read.
  const subjectPickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isSubjectPickerOpen) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const el = subjectPickerRef.current;
      if (el && !el.contains(event.target as Node)) setIsSubjectPickerOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsSubjectPickerOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isSubjectPickerOpen]);

  useEffect(() => {
    onResultsCountChange?.(activeResults?.results.length ?? 0);
  }, [activeResults, onResultsCountChange]);

  // Clear temporary message when user's message appears in database
  useEffect(() => {
    if (messages.length > 0 && tempUserMessageForLoggedIn) {
      // Check if the most recent user message matches our temporary message
      const userMessages = messages.filter(message => message.role === 'user');
      const latestUserMessage = userMessages[userMessages.length - 1];
      if (latestUserMessage && latestUserMessage.content === tempUserMessageForLoggedIn) {
        setTempUserMessageForLoggedIn(null);
        setTempUserImages([]);
      }
    }
  }, [messages, tempUserMessageForLoggedIn]);

  // Typing effect for placeholder
  const fullPlaceholder = "I'm looking for a modern apartment with city views, close to cafes and markets. I love minimalist design and need good natural light... (or upload reference images)";
  useEffect(() => {
    if (messages.length === 0) {
      let i = 0;
      const typingInterval = setInterval(() => {
        setTypedPlaceholder(fullPlaceholder.slice(0, i + 1));
        i++;
        if (i >= fullPlaceholder.length) {
          clearInterval(typingInterval);
        }
      }, 50);
      return () => clearInterval(typingInterval);
    } else {
      setTypedPlaceholder("Ask me about properties, neighborhoods, or anything else...");
    }
  }, [messages.length, fullPlaceholder]);

  // Badge score for a result card: the AI's matchScore, which rates fit to the
  // CURRENT SEARCH QUERY. This intentionally differs from Matches/Swipe, which
  // rate against saved preferences — the card's scoreContext="search" popover
  // explains the distinction to the renter.
  const cardVibeScore = (property: PropertyMatch) =>
    typeof property.matchScore === 'number' ? { overall: property.matchScore } : undefined;

  // Compute all results from messages to avoid infinite re-renders
  const allResults = useMemo(() => {
    const results: PropertyMatch[] = [];
    messages.forEach(message => {
      if (message.role === 'assistant') {
        try {
          const parsed = JSON.parse(message.content);
          if (parsed.results && Array.isArray(parsed.results)) {
            results.push(...parsed.results);
          }
        } catch (e) {
          // Not JSON, ignore
        }
      }
    });
    return results;
  }, [messages]);

  // Always start with empty session by default - user can manually select chat history if needed
  useEffect(() => {
    if (user && !currentConversationId) {
      // Start fresh - no automatic loading of previous conversations
      startFreshChat();
    }
  }, [user, currentConversationId, startFreshChat]);

  // Check for stored search query on component mount
  useEffect(() => {
    const storedQuery = localStorage.getItem('pendingSearchQuery');
    if (storedQuery) {
      setQuery(storedQuery);
      if (user) {
        localStorage.removeItem('pendingSearchQuery');
        // Auto-trigger search with stored query after a brief delay
        setTimeout(() => handleSearch(storedQuery), 100);
      }
    }
    // Keyed on sign-in alone. handleSearch is rebuilt every render, so listing
    // it would run this on every render - and signed out, that would keep
    // writing the stored query back over whatever is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);
  // Opening message, auto-sent exactly once into an empty conversation: the
  // quiz hands over a preference-derived query, the landing page hands over
  // whatever the renter typed there.
  //
  // Waits on auth resolving rather than on there being a user - a signed-out
  // visitor's handoff has to send too, and firing while `user` is still null
  // would push a signed-in renter's first message down the anonymous path.
  useEffect(() => {
    if (!initialQuery || !initialQuery.trim()) return;
    if (initialQuerySentRef.current) return;
    if (authLoading) return;
    if (messages.length > 0 || hasSearched) return;
    initialQuerySentRef.current = true;
    setQuery(initialQuery);
    // Defer so the input paints before the request fires.
    const t = setTimeout(() => {
      handleSearch(initialQuery, { images: initialImages });
      onInitialQueryConsumed?.();
    }, 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery, authLoading, messages.length]);

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      const newImages = Array.from(files).slice(0, 3); // Limit to 3 images
      setUploadedImages(prev => [...prev, ...newImages].slice(0, 3));
    }
  };
  const removeImage = (index: number) => {
    setUploadedImages(prev => prev.filter((_, i) => i !== index));
  };
  const convertImageToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };
  const createNewChat = () => {
    // Clear all chat-related state completely
    startFreshChat();
    setQuery('');
    setUploadedImages([]);
    setSearchResults(null);
    setShowHistory(false);
    setWantsNewChat(true);
    setHasSearched(false);
    setTempUserMessage(null);
    setTempUserMessageForLoggedIn(null);
    setTempUserImages([]);
    setLikedProperties(new Set());
    setIsFastTrackBannerDismissed(false);
    // Clear any stored pending queries
    localStorage.removeItem('pendingSearchQuery');
  };
  const switchToConversation = async (conversationId: string) => {
    setCurrentConversationId(conversationId);
    setShowHistory(false);
    setWantsNewChat(false);
    setHasSearched(true); // Existing conversation means user has searched before
    // Clear any temporary states when switching to existing conversation
    setTempUserMessage(null);
    setTempUserMessageForLoggedIn(null);
    setTempUserImages([]);
    setSearchResults(null); // Clear anonymous search results

    // Ensure the conversation has messages, if not, it might be an empty one
    const {
      data: conversationMessages
    } = await supabase.from('chat_messages').select('id').eq('conversation_id', conversationId).limit(1);
    if (!conversationMessages || conversationMessages.length === 0) {
      console.log(`Conversation ${conversationId} appears to be empty`);
    }
  };
  // One way to ask for a viewing (invariant 8). Crawled listings only - the
  // viewing flow requests against them - and one day of viewings holds five.
  const seedOf = (p: PropertyMatch): RequestSeed => ({ listingId: p.id, title: p.title, imageUrl: p.images?.[0] ?? null });
  const openScheduleForIds = (ids: string[]) => {
    const seeds = allResults.filter(p => ids.includes(p.id) && p.isExternal).slice(0, MAX_ITEMS).map(seedOf);
    if (seeds.length > 0) setRequestSeeds(seeds);
    setIsFastTrackBannerDismissed(false);
  };

  const triggerFastTrackPrompt = (_propertyId: string) => {
    // CTA popup removed — the in-chat banner handles the scheduling prompt.
  };

  const handleLikeProperty = async (propertyId: string, realtorId?: string) => {
    if (!user) {
      localStorage.setItem('pendingSearchQuery', query);
      navigate('/auth', { state: { returnTo: '/' } });
      return;
    }
    try {
      setLikedProperties(prev => new Set([...prev, propertyId]));

      // Find the actual realtor ID from the search results
      const property = allResults.find(p => p.id === propertyId);
      const actualRealtorId = property?.realtor_id || realtorId;

      // Check if this is an external property (realtor_id starts with "ext-")
      const isExternal = actualRealtorId?.startsWith('ext-');

      if (isExternal) {
        // For external properties, use current user's ID as placeholder realtor_id
        // since there's no real realtor in the system for external listings
        await createMatch(propertyId, user.id, 'external');
        triggerFastTrackPrompt(propertyId);
        return;
      }

      if (!actualRealtorId) {
        const { data: propertyData } = await supabase
          .from('properties')
          .select('realtor_id')
          .eq('id', propertyId)
          .single();
        if (propertyData?.realtor_id) {
          await createMatch(propertyId, propertyData.realtor_id);
          triggerFastTrackPrompt(propertyId);
        } else {
          toast({
            title: "Error",
            description: "Could not create match - realtor information missing",
            variant: "destructive"
          });
        }
      } else {
        await createMatch(propertyId, actualRealtorId);
        triggerFastTrackPrompt(propertyId);
      }
    } catch (error: any) {
      console.error('Error liking property:', error);
      // Don't revert if it's ALREADY_MATCHED - keep it visually liked, and still offer scheduling
      if (error?.message === 'ALREADY_MATCHED') {
        triggerFastTrackPrompt(propertyId);
      } else {
        setLikedProperties(prev => {
          const newSet = new Set(prev);
          newSet.delete(propertyId);
          return newSet;
        });
      }
      // Toast is already handled by useMatches onError
    }
  };


  const handleFollowup = (suggestion: string) => {
    if (!suggestion?.trim()) return;
    // For anonymous users, inject prior assistant context so the follow-up
    // doesn't lose the blocks context (logged-in users get it via history).
    let augmented = suggestion;
    if (!user && searchResults) {
      const ctxParts: string[] = [];
      if (searchResults.summary) ctxParts.push(searchResults.summary);
      const blockHints = (searchResults.blocks || [])
        .map((b: any) => {
          if (b?.type === 'complex' && b.name) return `complex ${b.name}`;
          if (b?.type === 'district' && b.district) return `district ${b.district}`;
          if (b?.type === 'distance' && b.from && b.to) return `${b.from}→${b.to}`;
          return null;
        })
        .filter(Boolean)
        .slice(0, 4)
        .join(', ');
      if (blockHints) ctxParts.push(`Previously discussed: ${blockHints}.`);
      if (ctxParts.length > 0) {
        augmented = `[Context: ${ctxParts.join(' ')}]\nFollow-up: ${suggestion}`;
      }
    }
    handleSearch(augmented, { isFollowup: true });
  };

  const handleSearch = async (searchQuery?: string, options?: { isFollowup?: boolean; subjectIds?: string[]; images?: File[] }) => {
    const queryToUse = searchQuery || query;
    const isFollowup = !!options?.isFollowup;
    // Same reasoning as the ids below: a caller handing the message over from
    // somewhere else (the landing page) passes its attachments in directly
    // rather than through the composer's state.
    const imagesToUse = options?.images ?? uploadedImages;
    // Callers that pin listings and ask in the same breath (the compare flow)
    // pass the ids in directly - reading them back out of state here would race
    // the setSubjects that just happened.
    const contextIds = options?.subjectIds
      ?? subjects.map(s => s.propertyId).filter((id): id is string => !!id);

    // Prevent new messages while AI is processing for both user types
    if (isSendingMessage || isSearching) {
      return;
    }

    // The doorway composer doesn't answer: park the message and let the hub's
    // chat send it. Deliberately ahead of the limit checks below - the message
    // is only spent where it is actually sent, so the allowance is counted once
    // and the wall, when it comes, lands on the page the renter ends up on.
    if (handoffToHub && (queryToUse.trim() || imagesToUse.length > 0)) {
      setChatHandoff({ query: queryToUse, images: imagesToUse, subjects: handoffSubjects });
      setQuery('');
      setUploadedImages([]);
      navigate('/hub');
      return;
    }

    // Check AI request limits for logged-in users
    if (user && !canPerformAction('ai-search')) {
      toast({
        title: "You've used today's AI credits",
        description: `Free accounts get ${FREE_TIER_LIMITS.dailyAiRequests} AI credits a day. The Pass makes them unlimited, or try again tomorrow.`,
        variant: "destructive"
      });
      return;
    }

    // For anonymous users, allow a few searches before the sign-up wall.
    if (!user && anonSearchCount >= ANON_SEARCH_LIMIT) {
      toast({
        title: "Sign up to keep searching",
        description: "You've used your free searches. Create an account to keep going — your conversation is saved.",
      });
      setTimeout(() => navigate('/auth', { state: { returnTo: '/hub' } }), 1500);
      return;
    }
    if (!queryToUse.trim() && imagesToUse.length === 0) {
      toast({
        title: "Please describe your ideal home or upload an image",
        description: "Tell us what you're looking for or show us a reference image",
        variant: "destructive"
      });
      return;
    }
    if (user) {
      // Show user message immediately for logged-in users
      setTempUserMessageForLoggedIn(queryToUse);
      setTempUserImages(imagesToUse.length > 0 ? await Promise.all(imagesToUse.map(async file => await convertImageToBase64(file))) : []);
      const messageData = {
        message: queryToUse,
        userType: 'renter' as const,
        userPreferences,
        propertyImages: imagesToUse.length > 0 ? await Promise.all(imagesToUse.map(async file => await convertImageToBase64(file))) : [],
        // Pinned listings travel with every message, so "is this one still
        // available?" resolves without the renter naming it again.
        contextPropertyIds: contextIds
      };
      try {
        // Send message - this will create a conversation if needed
        if (currentConversationId) {
          await sendMessage({
            ...messageData,
            conversationId: currentConversationId
          });
        } else {
          await sendMessageWithoutConversation(messageData.message, messageData.userType, messageData.userPreferences, messageData.propertyImages, messageData.contextPropertyIds);
        }

        // Note: AI search usage is now tracked server-side in chat-ai edge function
        // Refetch usage to get updated counts
        await refetchUsage();
        setHasSearched(true);
        setWantsNewChat(false); // Reset new chat flag after successful search
        toast({
          title: "Message sent!",
          description: "Hausto Agent is processing your request."
        });
      } catch (error) {
        console.error('Search error:', error);
        toast({
          title: "Search failed",
          description: "There was an error processing your search. Please try again.",
          variant: "destructive"
        });
        // Clear temporary message on error
        setTempUserMessageForLoggedIn(null);
        setTempUserImages([]);
      } finally {
        setQuery('');
        setUploadedImages([]);
      }
    } else {
      // Handle search for anonymous users - call Hausto Agent directly
      setTempUserMessage(queryToUse); // Show user message immediately
      setTempUserImages(imagesToUse.length > 0 ? await Promise.all(imagesToUse.map(async file => await convertImageToBase64(file))) : []);
      setIsSearching(true);
      try {
        const messageData = {
          message: queryToUse,
          userType: 'renter' as const,
          userPreferences: null,
          // Anonymous users don't have saved preferences
          propertyImages: imagesToUse.length > 0 ? await Promise.all(imagesToUse.map(async file => await convertImageToBase64(file))) : [],
          // Pinned listings travel with a signed-out visitor's message too.
          // Without them "compare these two" reached the server as a bare
          // question with nothing pinned, and came back as a fresh search.
          contextPropertyIds: contextIds,
          // Follow-up chip taps are exempt from the server's anon search limit.
          isFollowup
        };
        const response = await invokeFunction<any>('chat-ai', {
          body: messageData
        });
        if (response.error) {
          throw response.error;
        }

        // Check if auth is required (returned from edge function)
        if (response.data?.requiresAuth) {
          toast({
            title: "Sign in to continue",
            description: response.data.response || "Please sign in to continue chatting."
          });
          setTimeout(() => {
            navigate('/auth', {
              state: {
                returnTo: '/'
              }
            });
          }, 2000);
          return;
        }

        // Parse AI response to extract search results
        let searchResults: SearchResult | null = null;
        if (response.data?.response) {
          try {
            const parsed = JSON.parse(response.data.response);
            if (parsed.results && Array.isArray(parsed.results)) {
              searchResults = parsed;
            } else if (parsed.blocks && Array.isArray(parsed.blocks)) {
              searchResults = {
                results: [],
                summary: parsed.summary || '',
                totalMatches: 0,
                blocks: parsed.blocks,
              };
            }
          } catch (e) {
            // If not JSON, treat as text response
            searchResults = {
              results: [],
              summary: response.data.response,
              totalMatches: 0
            };
          }
        }
        if (searchResults) {
          setSearchResults(searchResults);
        }
        setHasSearched(true);
        // Only new searches count toward the anonymous cap; follow-ups are free.
        if (!isFollowup) {
          setAnonSearchCount(count => {
            const next = count + 1;
            writeAnonSearchCount(next);
            return next;
          });
        }
        toast({
          title: "Search completed!",
          description: "AI has processed your search request."
        });
      } catch (error) {
        console.error('Anonymous search error:', error);
        toast({
          title: "Search failed",
          description: "There was an error processing your search. Please try again.",
          variant: "destructive"
        });
      } finally {
        setIsSearching(false);
        setQuery('');
        setUploadedImages([]);
        // Keep tempUserMessage and images so the user's message remains visible after results
      }
    }
  };

  // Kept current on every render so the compare listener above always calls
  // the live handleSearch rather than the one from the render it was bound in.
  handleSearchRef.current = handleSearch;

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSearch();
    }
  };
  const handleBrowseAll = () => {
    navigate('/hub');
  };
  // Where the preview says a listing came from. A Hausto listing links to its
  // own page; a crawled one names its marketplace and links nowhere - the
  // original ad carries the agent's number, which "Request viewing" offers a
  // signed-in renter as a choice (ViewingChoice, CLAUDE.md invariant 4).
  const previewSourceOf = (property: PropertyMatch): { name: string; href?: string | null } => {
    if (!property.isExternal) return { name: 'Hausto', href: `/property/${property.id}` };
    return { name: getPropertySourceLogo(property.source || '').name, href: null };
  };

  // A Deep Scan asked for from a card on this page. The chat is already here,
  // so the ask is answered in place rather than travelling through the handoff.
  useEffect(() => {
    const onScan = (event: Event) => {
      const detail = (event as CustomEvent<DeepScanDetail>).detail;
      if (!detail?.propertyId) return;
      setScanRequest(detail);
    };
    window.addEventListener(DEEP_SCAN_EVENT, onScan);
    return () => window.removeEventListener(DEEP_SCAN_EVENT, onScan);
  }, []);

  const handlePropertyClick = async (property: PropertyMatch) => {
    try {
      // Try to fetch full property details from database by ID
      const {
        data: fullProperty
      } = await supabase.from('properties').select(PROPERTY_PUBLIC_COLUMNS).eq('id', property.id).single();
      if (fullProperty) {
        const enriched = {
          ...property,
          images: fullProperty.images?.length ? fullProperty.images : property.images,
          description: fullProperty.description || property.description,
          highlights: fullProperty.highlights?.length ? fullProperty.highlights : property.highlights,
          amenities: fullProperty.amenities?.length ? fullProperty.amenities : property.amenities,
          size: fullProperty.size || property.size,
          price: Number(fullProperty.price ?? property.price),
          vibe: fullProperty.vibe || property.vibe,
          vibe_analysis: fullProperty.vibe_analysis ?? property.vibe_analysis,
          realtor_id: fullProperty.realtor_id || property.realtor_id
        } as PropertyMatch;
        setSelectedProperty(enriched);
      } else {
        // Not a Hausto listing, so it came from the crawler. Search truncates
        // descriptions to keep the results payload small, which left a crawled
        // listing's prose cut mid-sentence with nothing behind the "more"
        // toggle - the full text only exists on the row itself.
        const { data: external } = await supabase
          .from('external_properties')
          .select('description, highlights, amenities, images, size, vibe, vibe_analysis')
          .eq('id', property.id)
          .maybeSingle();
        setSelectedProperty(
          external
            ? ({
                ...property,
                images: external.images?.length ? external.images : property.images,
                description: external.description || property.description,
                highlights: external.highlights?.length ? external.highlights : property.highlights,
                // The row's own list, as the listing's page reads it.
                amenities: external.amenities?.length ? external.amenities : property.amenities,
                size: external.size || property.size,
                vibe: external.vibe || property.vibe,
                vibe_analysis: external.vibe_analysis ?? property.vibe_analysis,
              } as PropertyMatch)
            : property,
        );
      }
    } catch (e) {
      // Fallback to original result on error
      setSelectedProperty(property);
    }
    setAnalysisProperty(prev => prev?.id === property.id ? prev : property);
    setShowPropertyModal(true);
  };

  // Rendered either in the thread or into the host's heading row - the same
  // two buttons either way, so the conversation they act on stays one thing.
  const chatControls = (
    <>
      <Button onClick={() => setShowHistory(!showHistory)} variant="ghost" size="sm" aria-label="Chat history" className="h-8 w-8 p-0 hover:bg-secondary/50">
        <History className="h-4 w-4" aria-hidden="true" />
      </Button>
      <Button onClick={createNewChat} variant="ghost" size="sm" aria-label="New chat" className="h-8 w-8 p-0 hover:bg-secondary/50">
        <Plus className="h-4 w-4" aria-hidden="true" />
      </Button>
    </>
  );

  return <div className={isRail ? 'w-full h-full flex flex-col min-h-0' : 'w-full max-w-4xl mx-auto mt-4 px-1'}>
      <div className={isRail
        // The outer rail/dock container flexes full height but doesn't scroll.
        // It holds the scrollable thread, and the fixed composer at the bottom.
        ? 'flex-1 min-h-0 flex flex-col p-3'
        : 'p-3 md:p-6 glass-card rounded-2xl animate-fade-in relative z-10 flex flex-col'}>
        
        {/* Scrollable Conversation Area */}
        <div className={isRail ? 'flex-1 min-h-0 flex flex-col gap-2 overflow-y-auto pr-1' : 'flex flex-col gap-2'}>
      {/* Header — history / new-chat controls. Given a headerPortal they move up
          onto the pane's own "Hausto Agent" heading, which already has a half-empty
          row; without one they sit in normal flow so they reserve their own row
          and never overlap the composer in the compact state. */}
      {user && (headerPortal
        ? createPortal(chatControls, headerPortal)
        : <div className="flex justify-end gap-2 mb-2">{chatControls}</div>)}

      {/* Chat History Dropdown */}
      {showHistory && user && <Card className="mb-3 border-border">
          <CardContent className="p-4">
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {conversations.map(conversation => <div key={conversation.id} onClick={() => switchToConversation(conversation.id)} className={`p-3 rounded-lg cursor-pointer transition-colors ${conversation.id === currentConversationId ? 'bg-primary/10 border border-primary/20' : 'hover:bg-secondary/50'}`}>
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate text-left">{conversation.title || 'New Search'}</p>
                      <p className="text-xs text-muted-foreground text-left">
                        {new Date(conversation.updated_at || conversation.created_at).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                      hour12: true
                    })}
                      </p>
                    </div>
                  </div>
                </div>)}
            </div>
          </CardContent>
        </Card>}

      {/* Chat Messages for Signed In Users — compact until there's content, then grows/scrolls */}
      {/* A Deep Scan opens this too. It is read here, so it has to be able to
          be the first thing in the thread - a renter can ask for one before
          they have said anything to the AI, and an empty conversation used to
          mean there was no thread for the scan to land in. */}
      {user && (messages.length > 0 || tempUserMessageForLoggedIn || isSendingMessage || scanRequest || analysisProperty) && <div className="space-y-4 mb-4">
          {messages.map((message, index) => {
          if (message.role === 'user') {
            return <div key={index} className="flex justify-end animate-slide-up">
                  <div className="max-w-[80%] p-4 rounded-2xl rounded-tr-sm bg-primary text-white shadow-md space-y-2">
                    <p className="text-sm text-left">{message.content}</p>
                    {message.metadata?.images && message.metadata.images.length > 0 && <div className="flex gap-2 flex-wrap">
                        {message.metadata.images.map((image, imgIndex) => <img key={imgIndex} src={image} alt={`Reference ${imgIndex + 1}`} className="w-16 h-16 object-cover rounded-lg border border-white/20" />)}
                      </div>}
                  </div>
                </div>;
          } else {
            const { searchResults, displayContent } = parsedMessages[index] ?? {
              searchResults: null,
              displayContent: message.content,
            };
            // Separate non-followup blocks (text/district/etc.) from followup chips
            const topBlocks = (searchResults?.blocks || []).filter((b: any) => !BELOW_RESULTS.has(b.type));
            const followupBlocks = (searchResults?.blocks || []).filter((b: any) => BELOW_RESULTS.has(b.type));
            const cards = searchResults?.results ?? [];
            const isShowing = hoistResults && activeResultsIdx === index;
            return <div key={index} className="flex justify-start animate-slide-up">
                  <div className="w-full space-y-4">
                    {searchResults?.summary && <div className="glass p-4 rounded-2xl rounded-tl-sm max-w-[85%] sm:max-w-[70%] md:max-w-[60%] w-fit shadow-sm">
                        <p className="text-sm text-left text-foreground/90 leading-relaxed">{searchResults.summary}</p>
                      </div>}

                    {/* Plain prose reply (advice, a clarifying question, a fallback) */}
                    {!searchResults && <div className="glass p-4 rounded-2xl rounded-tl-sm max-w-[85%] sm:max-w-[70%] md:max-w-[60%] w-fit shadow-sm">
                        <p className="text-sm whitespace-pre-wrap text-left text-foreground/90 leading-relaxed">{displayContent}</p>
                      </div>}

                    {/* Text/info blocks shown ABOVE results */}
                    <AIBlocks blocks={topBlocks} onFollowup={handleFollowup} />

                    {cards.length > 0 && (hoistResults ? (
                      // The listings themselves are in the main pane; the thread
                      // keeps a handle so an earlier search can be pulled back.
                      <button
                        type="button"
                        onClick={() => setActiveResultsIdx(index)}
                        disabled={isShowing}
                        className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs transition-colors ${
                          isShowing
                            ? 'border-primary/25 bg-primary/5 text-muted-foreground'
                            : 'border-border bg-background hover:border-primary/50'
                        }`}
                      >
                        <Home className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                        <span>
                          {cards.length} {cards.length === 1 ? 'place' : 'places'}
                          {isShowing ? ' - shown in the main pane' : ' - show these again'}
                        </span>
                      </button>
                    ) : (
                      <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-[640px]">
                          {cards.map(property => (
                            <EditorialPropertyCard
                              key={property.id}
                              apartment={property}
                              propertyType={property.isExternal ? 'external' : 'internal'}
                              compact
                              className="max-w-[300px] w-full mx-auto sm:mx-0"
                              vibeScore={cardVibeScore(property)}
                              scoreContext="search"
                              vibeDetailsText={property.matchReason}
                              quoteFallback={property.matchReason}
                              liked={likedProperties.has(property.id)}
                              onLike={() => handleLikeProperty(property.id, property.realtor_id)}
                            />
                          ))}
                        </div>
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground max-w-[640px]">
                          <Heart className="w-3.5 h-3.5 shrink-0 text-primary fill-primary" aria-hidden="true" />
                          Like a listing to save it.
                        </p>
                      </>
                    ))}

                    {/* Followup suggestions shown BELOW results */}
                    {followupBlocks.length > 0 && <AIBlocks blocks={followupBlocks} onFollowup={handleFollowup} />}
                  </div>
                </div>;
          }
        })}

          {/* Temporary user message for instant feedback - shows after all existing messages */}
          {tempUserMessageForLoggedIn && <div className="flex justify-end animate-slide-up">
              <div className="max-w-[80%] p-4 rounded-2xl rounded-tr-sm bg-primary text-white shadow-md space-y-2">
                <p className="text-sm text-left">{tempUserMessageForLoggedIn}</p>
                {tempUserImages.length > 0 && <div className="flex gap-2 flex-wrap">
                    {tempUserImages.map((image, index) => <img key={index} src={image} alt={`Reference ${index + 1}`} className="w-16 h-16 object-cover rounded-lg border border-white/20" />)}
                  </div>}
              </div>
            </div>}

          {isSendingMessage && <div className="flex justify-start animate-fade-in">
              <div className="glass p-4 rounded-2xl rounded-tl-sm shadow-sm">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{
                animationDelay: '0ms'
              }}></div>
                  <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{
                animationDelay: '150ms'
              }}></div>
                  <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{
                animationDelay: '300ms'
              }}></div>
                </div>
              </div>
            </div>}

          {/* Where a Deep Scan is read. It is long, and written against the
              renter's preferences, so it belongs in the conversation - with the
              room to read it, the listing it read still on screen beside it,
              and the AI that can be asked about what it says. A scan asked for
              from a chip reads itself on arrival; opening a listing only pins
              the offer, because spending the scan is the renter's call. */}
          {user && (scanRequest || analysisProperty) && (
            <div className="animate-fade-in">
              <DeepVibeAnalysis
                key={scanRequest?.propertyId ?? analysisProperty!.id}
                propertyId={scanRequest?.propertyId ?? analysisProperty!.id}
                propertyType={
                  scanRequest
                    ? scanRequest.propertyType ?? 'internal'
                    : analysisProperty!.isExternal
                      ? 'external'
                      : 'internal'
                }
                title={scanRequest?.title ?? analysisProperty!.title}
                autoGenerate={!!scanRequest}
                // The rail is narrow while the viewport is wide, so the offer
                // stacks here rather than becoming a row that overflows it.
                stacked
                onRequestPass={() => setIsSubscriptionModalOpen(true)}
              />
            </div>
          )}

        </div>}

      {/* Temporary Chat Messages for Non-Logged In Users */}
      {tempUserMessage && !user && <div className="space-y-4 mb-6">
          {/* User Message */}
          <div className="flex justify-end animate-slide-up">
            <div className="max-w-[80%] p-4 rounded-2xl rounded-tr-sm bg-primary text-white shadow-md space-y-2">
              <p className="text-sm text-left">{tempUserMessage}</p>
              {tempUserImages.length > 0 && <div className="flex gap-2 flex-wrap">
                  {tempUserImages.map((image, index) => <img key={index} src={image} alt={`Reference ${index + 1}`} className="w-16 h-16 object-cover rounded-lg border border-white/20" />)}
                </div>}
            </div>
          </div>
          
          {isSearching && <div className="flex justify-start animate-fade-in">
              <div className="glass p-4 rounded-2xl rounded-tl-sm shadow-sm">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{
                animationDelay: '0ms'
              }}></div>
                  <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{
                animationDelay: '150ms'
              }}></div>
                  <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{
                animationDelay: '300ms'
              }}></div>
                </div>
              </div>
            </div>}
        </div>}

      {/* Search Results for Non-Logged In Users */}
      {searchResults && !user && <div className="space-y-4 mb-6">
          <div className="flex justify-start animate-slide-up">
            <div className="w-full space-y-4">
              {searchResults.summary && <div className="glass p-4 rounded-2xl rounded-tl-sm max-w-[85%] sm:max-w-[70%] md:max-w-[60%] w-fit shadow-sm">
                  <p className="text-sm text-left text-foreground/90 leading-relaxed">{searchResults.summary}</p>
                </div>}
              {/* Text/info blocks shown ABOVE results */}
              <AIBlocks blocks={(searchResults.blocks || []).filter((b: any) => !BELOW_RESULTS.has(b.type))} onFollowup={handleFollowup} />
              
              {searchResults.results.length > 0 && <div className="space-y-4 max-w-[680px]">
                  {/* Same editorial cards as logged-in users see - unless the
                      host is hoisting them into a wider pane, in which case the
                      sign-up wall below is all that stays in the thread. */}
                  <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-[640px] ${hoistResults ? 'hidden' : ''}`}>
                    {searchResults.results.map(property => (
                      <EditorialPropertyCard
                        key={property.id}
                        apartment={property}
                        propertyType={property.isExternal ? 'external' : 'internal'}
                        compact
                        className="max-w-[300px] w-full mx-auto sm:mx-0"
                        vibeScore={cardVibeScore(property)}
                                 scoreContext="search"
                        vibeDetailsText={property.matchReason}
                        quoteFallback={property.matchReason}
                        onCardClick={() => handlePropertyClick(property)}
                        liked={likedProperties.has(property.id)}
                        onLike={() => handleLikeProperty(property.id, property.realtor_id)}
                      />
                    ))}
                  </div>
                  <p className={`flex items-center gap-1.5 text-xs text-muted-foreground ${hoistResults ? 'hidden' : ''}`}>
                    <Heart className="w-3.5 h-3.5 shrink-0 text-primary fill-primary" aria-hidden="true" />
                    Like a listing to save it.
                  </p>
                </div>}

              {/* Sign-up wall or Search Limit Tracker */}
              {anonLimitReached ? (
                <div className="bg-secondary/20 p-4 rounded-lg animate-fade-in text-center space-y-2 mt-4">
                  <p className="text-sm text-muted-foreground">
                    Sign up to keep searching — your conversation is saved.
                  </p>
                  <Button onClick={() => navigate('/auth', {
                    state: {
                      returnTo: '/hub'
                    }
                  })} className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-2">
                    Sign up to keep searching
                  </Button>
                </div>
              ) : (
                <div className="flex justify-start mt-3">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 px-4 py-3 rounded-2xl border border-primary/20 bg-primary/5 text-xs text-muted-foreground w-fit max-w-[85%] sm:max-w-[70%]">
                    <span className="font-medium text-primary">
                      {ANON_SEARCH_LIMIT - anonSearchCount} free {ANON_SEARCH_LIMIT - anonSearchCount === 1 ? 'search' : 'searches'} left today
                    </span>
                    <span className="hidden sm:inline text-primary/40">&bull;</span>
                    <span>
                      <button
                        className="font-medium text-foreground hover:text-primary underline underline-offset-2 decoration-primary/30"
                        onClick={() => navigate('/auth', { state: { returnTo: '/hub' } })}
                      >
                        Sign in for more
                      </button>
                      , and to save what you find.
                    </span>
                  </div>
                </div>
              )}


              {/* Followup suggestions BELOW results */}
              {(searchResults.blocks || []).some((b: any) => BELOW_RESULTS.has(b.type)) && (
                <AIBlocks blocks={(searchResults.blocks || []).filter((b: any) => BELOW_RESULTS.has(b.type))} onFollowup={handleFollowup} />
              )}
            </div>
          </div>
        </div>}


      {/* Viewing banner — appears once a user has liked a property in this chat */}
      {user && likedProperties.size > 0 && !isFastTrackBannerDismissed && (
        <div className="mb-3 rounded-xl border border-primary/30 bg-gradient-to-r from-primary/10 to-primary/5 p-3 flex flex-col sm:flex-row sm:items-center gap-3 animate-fade-in">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="h-9 w-9 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
              <CalendarCheck className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold leading-tight">
                {`You've liked ${likedProperties.size >= 3 ? '3+' : likedProperties.size} ${likedProperties.size === 1 ? 'property' : 'properties'}`}
              </p>
              <p className="text-xs text-muted-foreground leading-tight mt-0.5">
                Pick your times and we ask the agents. Your first viewing is on us; after that, the Pass.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap sm:flex-nowrap pl-12 sm:pl-0">
            <Button
              size="sm"
              onClick={() => openScheduleForIds(Array.from(likedProperties))}
            >
              Request viewings
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={() => setIsFastTrackBannerDismissed(true)}
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
      </div>

      {/* Fixed Input Area */}
      <div className={isRail ? 'shrink-0 flex flex-col pt-2' : 'flex flex-col'}>
      {/* Subject strip: which listings this conversation is about. Sits directly
          above the composer so the scope is visible while typing.

          Shown to a signed-out visitor too once something is pinned - their
          messages carry the pinned ids the same way (see handleSearch), so the
          strip is telling the truth, and on a listing's page it is the only
          thing that says the chat already knows what they are looking at. The
          picker below it needs an account for its matches, and hides itself
          when there are none. */}
      {isRail && (user || subjects.length > 0) && (
        // mt-auto here, not on the composer: this strip and the composer are
        // one group (it says what the conversation is about while you type),
        // and two auto margins would split the slack between them.
        // mb-2 keeps the chips off the composer's border; the relative anchors
        // the picker to the strip so it can span the composer's width.
        <div className="relative mt-auto mb-2 flex flex-wrap items-center gap-1.5">
          {/* Mobile combined chip */}
          {subjects.length > 1 && (
            <span className="xl:hidden inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 py-1 pl-2.5 pr-1 text-xs text-primary">
              <Home className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="font-medium px-1">{subjects.length} listings</span>
              <button
                aria-label="Clear all listings"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full hover:bg-primary/20"
                onClick={() => setSubjects([])}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          )}

          {/* Individual chips - hidden on mobile if > 1 */}
          {subjects.map((s) => (
            <span
              key={s.propertyId}
              className={`${subjects.length > 1 ? 'hidden xl:inline-flex' : 'inline-flex'} max-w-full items-center gap-1 rounded-full border border-primary/30 bg-primary/10 py-1 pl-2.5 pr-1 text-xs text-primary`}
            >
              <Home className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{s.title || 'This listing'}</span>
              <button
                aria-label={`Stop asking about ${s.title || 'this listing'}`}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full hover:bg-primary/20"
                onClick={() => setSubjects((prev) => prev.filter((x) => x.propertyId !== s.propertyId))}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))}

          {subjectOptions.length > 0 && (
            <div ref={subjectPickerRef}>
              <button
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground"
                aria-expanded={isSubjectPickerOpen}
                onClick={() => setIsSubjectPickerOpen((open) => !open)}
              >
                <Plus className="h-3 w-3" aria-hidden="true" />
                {subjects.length > 0 ? 'Add' : 'Ask about a match'}
              </button>

              {isSubjectPickerOpen && (
                // Opens upward, the full width of the composer. The strip sits
                // at the bottom of the rail, so dropping down ran the list off
                // the screen behind the composer with one row visible. Picking
                // closes it, so the reply it covers is back a tap later.
                <div className="absolute bottom-full left-0 right-0 z-20 mb-2 max-h-[min(20rem,50vh)] overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-xl">
                  {subjectOptions.map((o) => {
                    const picked = subjects.some((s) => s.propertyId === o.propertyId);
                    return (
                      <button
                        key={o.propertyId}
                        className="flex w-full items-center gap-2 rounded-lg p-1.5 text-left hover:bg-secondary"
                        onClick={() => toggleSubject(o)}
                      >
                        {o.image ? (
                          <img src={o.image} alt="" className="h-8 w-10 shrink-0 rounded object-cover" />
                        ) : (
                          <span className="h-8 w-10 shrink-0 rounded bg-secondary" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium">{o.title}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">{o.location}</span>
                        </span>
                        {picked && <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Chat Input - Show for everyone until they search */}
      {/* mt-auto belongs to whichever of the strip and this block comes first:
          they are one group at the bottom of the rail, and two auto margins
          split the slack between them - which is what left a signed-out
          visitor's pin marooned halfway up the pane. */}
      <div className={isRail ? `shrink-0 space-y-2 tall:space-y-4 xl:space-y-4${user || subjects.length > 0 ? '' : ' mt-auto'}` : 'space-y-4'}>

          {/* On the page the buttons get a row of their own inside the box, so
              the text runs its full width - over a right-hand margin it wrapped
              80px short on a phone. A tap on the row's empty part still lands in
              the text, as it did when the whole box was the textarea. The rail
              keeps the margin: a short screen gives it 68px, too little for a
              second row. */}
          <div className={isRail ? 'relative' : 'rounded-md border border-input ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2'}>
            <Textarea ref={composerRef} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={handleKeyPress} placeholder={!user && anonLimitReached ? 'Sign in to keep searching...' : typedPlaceholder} disabled={isSendingMessage || isSearching || (!user && anonLimitReached)} className={`${isRail ? 'min-h-[68px] tall:min-h-[104px] xl:min-h-[104px] pr-20' : 'min-h-[96px] sm:min-h-[60px] border-0 focus-visible:ring-0 focus-visible:ring-offset-0'} resize-none bg-transparent`} />
          <div className={isRail ? 'absolute bottom-3 right-3 flex gap-2' : 'flex justify-end gap-2 px-3 pb-3'} onClick={e => { if (e.target === e.currentTarget) composerRef.current?.focus(); }}>
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
            <Button onClick={() => fileInputRef.current?.click()} disabled={isSendingMessage || isSearching || uploadedImages.length >= 3 || (!user && anonLimitReached)} size="sm" variant="outline" aria-label="Upload image" className="h-8 w-8 p-0">
              <Upload className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button onClick={() => handleSearch()} disabled={isSendingMessage || isSearching || (!query.trim() && uploadedImages.length === 0) || (!user && anonLimitReached)} size="sm" aria-label="Send message" className="h-8 w-8 p-0">
              {isSendingMessage || isSearching ? <Send className="h-4 w-4" aria-hidden="true" /> : <PlaneTakeoff className="h-4 w-4" aria-hidden="true" />}
            </Button>
          </div>
        </div>

        {/* Image Preview */}
        {uploadedImages.length > 0 && <div className="flex gap-2 flex-wrap animate-fade-in">
            {uploadedImages.map((image, index) => <div key={index} className="relative">
                <img src={URL.createObjectURL(image)} alt={`Upload ${index + 1}`} className="w-16 h-16 object-cover rounded-lg border border-border" />
                <Button onClick={() => removeImage(index)} size="sm" variant="destructive" aria-label={`Remove image ${index + 1}`} className="absolute -top-2 -right-2 h-5 w-5 p-0 rounded-full">
                  <X className="h-3 w-3" aria-hidden="true" />
                </Button>
              </div>)}
          </div>}

        {/* Starter suggestions — shown until the conversation has content, so
            first-time users learn the AI does both searches AND area advice. A
            Deep Scan counts as content: in the mobile dock the chips plus the
            composer fill the sheet, and the scan they were sent to read is left
            with no height to render into. */}
        {!isRail && !hasSearched && !searchResults && !tempUserMessage && !tempUserMessageForLoggedIn && (!user || messages.length === 0) && !scanRequest && !analysisProperty && !isSearching && !isSendingMessage && (
          <div className="relative overflow-hidden w-full max-w-full pb-1 [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
            <div className="flex w-max gap-3 animate-marquee-reverse hover:[animation-play-state:paused]">
              {[
                { intent: 'search', text: '1BR in Thao Dien under 15M VND' },
                { intent: 'search', text: 'Pet-friendly 2BR with a pool near District 1' },
                { intent: 'ask', text: 'Which district suits young professionals?' },
                { intent: 'ask', text: "What's it like living in Binh Thanh?" },
                { intent: 'search', text: '1BR in Thao Dien under 15M VND' },
                { intent: 'search', text: 'Pet-friendly 2BR with a pool near District 1' },
                { intent: 'ask', text: 'Which district suits young professionals?' },
                { intent: 'ask', text: "What's it like living in Binh Thanh?" },
              ].map(({ intent, text }, i) => {
                const isSearch = intent === 'search';
                const Icon = isSearch ? Search : MessageCircle;
                return (
                  <Button
                    key={`${text}-${i}`}
                    variant="ghost"
                    size="sm"
                    title={isSearch ? 'Find listings' : 'Get advice'}
                    className={
                      `text-xs h-auto py-1.5 px-3 rounded-full inline-flex items-center gap-1.5 text-left shrink-0 whitespace-nowrap ` +
                      (isSearch
                        ? 'bg-primary/10 text-primary hover:bg-primary/20'
                        : 'bg-secondary/50 text-foreground hover:bg-secondary')
                    }
                    onClick={() => handleSearch(text)}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span>{text}</span>
                  </Button>
                );
              })}
            </div>
          </div>
        )}

        </div>
      </div>

      {/* Listings for the hub's main pane. Rendered through a portal rather
          than lifted into the parent so the like, vibe-score and detail-modal
          wiring stays here, where the conversation that produced them lives. */}
      {hoistResults && resultsPortal && activeResults && activeResults.results.length > 0 &&
        createPortal(
          <div className="space-y-4">
            {activeResults.summary && (
              <p className="max-w-3xl font-serif text-[15px] italic leading-relaxed text-muted-foreground">
                {activeResults.summary}
              </p>
            )}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {activeResults.results.map(property => (
                <EditorialPropertyCard
                  key={property.id}
                  apartment={property}
                  propertyType={property.isExternal ? 'external' : 'internal'}
                  compact
                  vibeScore={cardVibeScore(property)}
                  scoreContext="search"
                  vibeDetailsText={property.matchReason}
                  quoteFallback={property.matchReason}
                  onCardClick={() => handlePropertyClick(property)}
                  liked={likedProperties.has(property.id)}
                  onLike={() => handleLikeProperty(property.id, property.realtor_id)}
                />
              ))}
            </div>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Heart className="w-3.5 h-3.5 shrink-0 text-primary fill-primary" aria-hidden="true" />
              Like a listing to save it.
            </p>
          </div>,
          resultsPortal,
        )}

      {/* The same preview every other surface opens - see ListingPreviewDialog.
          Non-modal in the rail so the chat that produced this listing is still
          there to be asked about it. */}
      <ListingPreviewDialog
        open={showPropertyModal}
        onOpenChange={(o) => {
          if (!o) {
            setShowPropertyModal(false);
            setSelectedProperty(null);
          }
        }}
        embedded={isRail}
        apartment={selectedProperty ? {
          id: selectedProperty.id,
          images: selectedProperty.images || [],
          title: selectedProperty.title,
          location: selectedProperty.location,
          price: selectedProperty.price,
          size: selectedProperty.size,
          rooms: selectedProperty.rooms || null,
          vibe: selectedProperty.vibe,
          description: selectedProperty.description,
          highlights: selectedProperty.highlights,
          // The listing's own list (chat-ai: the ad's, then the photos'), not
          // the photo analysis's alone - so the preview shows what the
          // listing's page does.
          amenities: selectedProperty.amenities || [],
          vibe_analysis: selectedProperty.vibe_analysis,
        } : null}
        vibeScore={selectedProperty ? cardVibeScore(selectedProperty) : undefined}
        scoreContext="search"
        vibeDetailsText={selectedProperty?.matchReason}
        quoteFallback={selectedProperty?.matchReason}
        liked={selectedProperty ? likedProperties.has(selectedProperty.id) : false}
        onLike={selectedProperty ? () => handleLikeProperty(selectedProperty.id, selectedProperty.realtor_id) : undefined}
        // Signed out goes to sign-in; otherwise the request modal. Requests
        // are free, so there is no allowance to check.
        onSchedule={selectedProperty?.isExternal ? () => {
          if (!user) {
            navigate('/auth', { state: { returnTo: '/hub' } });
            return;
          }
          setRequestSeeds([seedOf(selectedProperty)]);
        } : undefined}
        source={selectedProperty ? previewSourceOf(selectedProperty) : undefined}
        propertyType={selectedProperty?.isExternal ? 'external' : 'internal'}
      />

      <RequestViewingModal
        open={!!requestSeeds}
        onOpenChange={o => { if (!o) setRequestSeeds(null); }}
        seeds={requestSeeds ?? []}
      />

      <SubscriptionModal
        isOpen={isSubscriptionModalOpen}
        onClose={() => setIsSubscriptionModalOpen(false)}
      />
      </div>
    </div>;
};