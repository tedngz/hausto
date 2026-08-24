import { useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router-dom';
import { ChevronUp, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BrowseTable, type BrowseTableFilters } from '@/components/BrowseTable';
import { MatchesView } from '@/components/MatchesView';
import { HomeAI } from '@/components/HomeAI';
import { SubscriptionModal } from '@/components/SubscriptionModal';
import { HubNavigation } from '@/components/hub/HubNavigation';
import { HubPreferenceBar } from '@/components/hub/HubPreferenceBar';
import { HubModeTabs, type HubMode } from '@/components/hub/HubModeTabs';
import { HubNewListings } from '@/components/hub/HubNewListings';
import { CurrencyProvider } from '@/contexts/CurrencyContext';
import { useAuth } from '@/hooks/useAuth';
import { useMatches } from '@/hooks/useMatches';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { cityForDistricts } from '@/utils/districts';
import { normalizeSize } from '@/lib/preferences';

// The rate public-property-search compares VND listing prices against.
const VND_PER_USD = 24500;

// Quiz size answers, in the browse table's room-filter vocabulary.
const SIZE_TO_ROOMS: Record<string, string> = {
  studio: 'studio',
  '1br': '1',
  '2br': '2',
  '3br+': '3',
};

/**
 * The hub: one screen for the three things renters were bouncing between.
 *
 * Desktop is two panes - a mode-switched main pane (browse table / AI results /
 * matches) and a docked AI chat rail that never goes away. Below lg the rail
 * collapses to a bar that opens as a sheet, because the comparison table needs
 * every pixel of width it can get.
 */
const Hub = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { renterMatches } = useMatches();
  const { preferences, isResolved: prefsResolved } = useUserPreferences();

  const hasRail = useMediaQuery('(min-width: 1024px)');
  const [mode, setMode] = useState<HubMode>('browse');
  const [isSubscriptionModalOpen, setIsSubscriptionModalOpen] = useState(false);
  // Below lg the chat is a sheet rather than a column.
  const [isChatOpen, setIsChatOpen] = useState(false);
  // The chat renders its listings into this node. Held in state rather than a
  // ref so the first render after it mounts actually reaches HomeAI.
  const [resultsPortal, setResultsPortal] = useState<HTMLDivElement | null>(null);
  const [resultsCount, setResultsCount] = useState(0);
  // A search finishing while the renter is on another tab shouldn't yank them
  // away, but the first one should - otherwise their results land off-screen.
  const hasSeenResults = useRef(false);

  useEffect(() => {
    if (resultsCount > 0 && !hasSeenResults.current) {
      hasSeenResults.current = true;
      setMode('ai');
    }
  }, [resultsCount]);

  // The table opens on what the renter said they wanted rather than on all
  // 1,400 listings. Seeded once, so their own filter changes stick afterwards -
  // which means waiting for preferences before the table mounts.
  const seedReady = prefsResolved || !!preferences;
  const browseSeed = useMemo<BrowseTableFilters | undefined>(() => {
    if (!preferences) return undefined;
    const districts = preferences.location ?? [];
    const [minVnd, maxVnd] = preferences.priceRange ?? [0, 0];
    const size = normalizeSize(preferences.size);
    return {
      city: cityForDistricts(districts),
      districts,
      rooms: SIZE_TO_ROOMS[size] ?? 'all',
      // The table's budget inputs are USD; preferences are VND. Same rate the
      // search function uses to compare them.
      minBudget: minVnd > 0 ? String(Math.round(minVnd / VND_PER_USD)) : '',
      maxBudget: maxVnd > 0 ? String(Math.round(maxVnd / VND_PER_USD)) : '',
    };
  }, [preferences]);

  useEffect(() => {
    if (!loading && !user) navigate('/');
  }, [user, loading, navigate]);

  // Quota walls raised from the table or the chat dispatch this - the hub has
  // to answer it too, or upgrading from here silently does nothing.
  useEffect(() => {
    const open = () => setIsSubscriptionModalOpen(true);
    window.addEventListener('openSubscriptionModal', open);
    return () => window.removeEventListener('openSubscriptionModal', open);
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-slate-100">
        <div className="text-center">
          <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  const userProfile = {
    name: user.user_metadata?.name || '',
    email: user.email || '',
    phone: user.user_metadata?.phone || '',
  };

  // One chat instance, moved between the rail and the mobile sheet by which of
  // the two is rendered - never both, so the conversation is never duplicated.
  const chat = (
    <HomeAI
      variant="rail"
      userPreferences={preferences ?? undefined}
      resultsPortal={resultsPortal}
      onResultsCountChange={setResultsCount}
    />
  );

  return (
    <CurrencyProvider>
      <Helmet>
        <title>Your search - Hausto</title>
        <meta
          name="description"
          content="Browse verified rentals, chat with the AI, and keep your matches in one place."
        />
        <link rel="canonical" href="https://hausto.lovable.app/hub" />
      </Helmet>

      <div className="flex h-[100dvh] flex-col overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100">
        <h1 className="sr-only">Your rental search on Hausto</h1>
        <HubNavigation />

        <div className="flex min-h-0 flex-1">
          {/* ---- Main pane ---- */}
          <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 lg:overflow-hidden lg:p-6">
            <HubPreferenceBar onOpenSubscription={() => setIsSubscriptionModalOpen(true)} />

            <HubNewListings />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <HubModeTabs
                mode={mode}
                onChange={setMode}
                counts={{ matches: renterMatches.length }}
              />
            </div>

            <div className="min-h-0 flex-1 lg:overflow-y-auto">
              {mode === 'browse' && (seedReady ? (
                <BrowseTable returnTo="/hub" embedded initialFilters={browseSeed} />
              ) : (
                <div className="flex items-center justify-center py-24">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ))}

              {/* Always mounted, so the chat has somewhere to put results the
                  moment they arrive rather than only once this tab is opened. */}
              <div className={mode === 'ai' ? undefined : 'hidden'}>
                <div ref={setResultsPortal} />
                {resultsCount === 0 && (
                  <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
                    <Sparkles className="h-8 w-8 text-primary" aria-hidden="true" />
                    <p className="font-serif text-xl">Ask the AI for something</p>
                    <p className="max-w-sm text-sm text-muted-foreground">
                      Results from the chat land here, with room to actually look at them.
                    </p>
                  </div>
                )}
              </div>

              {mode === 'matches' && (
                <MatchesView userPreferences={preferences ?? undefined} userProfile={userProfile} />
              )}
            </div>
          </main>

          {/* ---- Chat rail (lg and up) ---- */}
          {hasRail && (
            <aside className="flex w-[420px] shrink-0 flex-col border-l border-border bg-white/70 backdrop-blur-xl">
              <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
                <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
                <span className="font-serif text-base">AI search</span>
              </div>
              <div className="min-h-0 flex-1">{chat}</div>
            </aside>
          )}
        </div>

        {/* ---- Chat dock (below lg). Rendered instead of the rail, never
             alongside it - two mounted chats would be two conversations. ---- */}
        <div className={hasRail ? 'hidden' : 'shrink-0'}>
          {!hasRail && (isChatOpen ? (
            <div className="glass-card flex h-[70dvh] flex-col rounded-t-3xl">
              <div className="flex h-12 shrink-0 items-center justify-between px-4">
                <span className="flex items-center gap-2 font-serif text-base">
                  <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
                  AI search
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-11 px-3"
                  onClick={() => setIsChatOpen(false)}
                >
                  Close
                </Button>
              </div>
              <div className="min-h-0 flex-1">{chat}</div>
            </div>
          ) : (
            <button
              className="glass-card flex h-16 w-full items-center gap-3 rounded-t-3xl px-4 text-left"
              onClick={() => setIsChatOpen(true)}
            >
              <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span className="text-sm font-medium">Ask about what's on screen</span>
              <ChevronUp className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          ))}
        </div>

        <SubscriptionModal
          isOpen={isSubscriptionModalOpen}
          onClose={() => setIsSubscriptionModalOpen(false)}
        />
      </div>
    </CurrencyProvider>
  );
};

export default Hub;
