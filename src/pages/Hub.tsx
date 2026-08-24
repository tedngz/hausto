import { useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronLeft, ChevronUp, Heart, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BrowseTable } from '@/components/BrowseTable';
import { MatchesView } from '@/components/MatchesView';
import { ComplexDirectory } from '@/components/ComplexDirectory';
import { ComplexMapCanvas } from '@/components/ComplexMapCanvas';
import { OnboardingQuiz } from '@/components/OnboardingQuiz';
import { Profile } from '@/components/Profile';
import { FastTrackRequestsCard } from '@/components/FastTrackRequestsCard';
import { SubscriptionStatus } from '@/components/SubscriptionStatus';
import { UsageMeter } from '@/components/UsageMeter';
import { HomeAI } from '@/components/HomeAI';
import { SubscriptionModal } from '@/components/SubscriptionModal';
import { HubNavigation } from '@/components/hub/HubNavigation';
import { HubPreferenceBar } from '@/components/hub/HubPreferenceBar';
import { HubModeTabs, type HubMode } from '@/components/hub/HubModeTabs';
import { HubNewListings } from '@/components/hub/HubNewListings';
import { CurrencyProvider } from '@/contexts/CurrencyContext';
import { useAuth } from '@/hooks/useAuth';
import { useMatches } from '@/hooks/useMatches';
import { useComplexes } from '@/hooks/useComplexes';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { preferencesToSearchQuery } from '@/lib/preferences';

/**
 * Below this the page does not split into two panes at all.
 *
 * The comparison table has a hard 760px minimum, and a chat rail narrow enough
 * to fit beside it at 1024px is too cramped to hold a conversation - both panes
 * lose. 1280 is the first width where a usable rail (400px) and the full table
 * (760 + 48 padding) both fit without either one scrolling sideways. Under it,
 * the chat docks as a sheet and the table gets the whole width.
 *
 * Matches Tailwind's `xl`, which is what the breakpoint utilities below use.
 */
const RAIL_MIN_VIEWPORT = 1280;

/**
 * The hub: one screen for the three things renters were bouncing between.
 *
 * Desktop is two panes - a mode-switched main pane (browse table / AI results /
 * matches) and a docked AI chat rail that never goes away. Narrower than
 * RAIL_MIN_VIEWPORT the rail collapses to a bar that opens as a sheet, because
 * the comparison table needs every pixel of width it can get.
 */
const Hub = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { renterMatches } = useMatches();
  const { data: complexes, isLoading: complexesLoading } = useComplexes();
  const {
    preferences,
    isResolved: prefsResolved,
    hasPreferences,
    clearPreferences,
  } = useUserPreferences();

  const hasRail = useMediaQuery(`(min-width: ${RAIL_MIN_VIEWPORT}px)`);
  const [mode, setMode] = useState<HubMode>('browse');
  // Profile is a full-pane detour rather than a tab - it is account admin, not
  // part of the search loop the tabs describe.
  const [showProfile, setShowProfile] = useState(false);
  // Set once the quiz is done or dismissed, so it does not reappear while the
  // saved preferences are still making their way back from the DB.
  const [skippedOnboarding, setSkippedOnboarding] = useState(false);
  // One-shot opening message for the quiz handoff.
  const [seedQuery, setSeedQuery] = useState<string | undefined>(undefined);
  const [isSubscriptionModalOpen, setIsSubscriptionModalOpen] = useState(false);
  // Narrow viewports get the chat as a sheet rather than a column.
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

  // No auth gate: the hub is the public front door. A visitor can browse the
  // whole verified set, read building profiles and try the AI a few times;
  // saving, matching and preferences are what ask them to sign in.

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

  // Brand-new renters do the quiz first - it used to live on /discover, which
  // renters no longer see. Held until preferences resolve so a returning renter
  // never flashes the quiz on a slow query. Signed-out visitors skip it: the
  // quiz has nowhere to save to, and demanding it before they can look at
  // anything is exactly the wall this page is meant not to be.
  if (user && prefsResolved && !hasPreferences && !skippedOnboarding) {
    return (
      <CurrencyProvider>
        <div className="min-h-[100dvh] bg-gradient-to-br from-slate-50 via-white to-slate-100">
          <OnboardingQuiz
            onComplete={(prefs) => {
              // Straight into the chat, pre-seeded with what they just told us,
              // rather than dropping them on a cold table.
              setSeedQuery(preferencesToSearchQuery(prefs));
              setMode('ai');
              setSkippedOnboarding(true);
            }}
            onSkip={() => setSkippedOnboarding(true)}
          />
        </div>
      </CurrencyProvider>
    );
  }

  const userProfile = {
    name: user?.user_metadata?.name || '',
    email: user?.email || '',
    phone: user?.user_metadata?.phone || '',
  };

  // One chat instance, moved between the rail and the mobile sheet by which of
  // the two is rendered - never both, so the conversation is never duplicated.
  const chat = (
    <HomeAI
      variant="rail"
      userPreferences={preferences ?? undefined}
      initialQuery={seedQuery}
      onInitialQueryConsumed={() => setSeedQuery(undefined)}
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
        <HubNavigation
          onViewProfile={() => setShowProfile(true)}
          onRestartOnboarding={() => {
            clearPreferences();
            setSkippedOnboarding(false);
            setShowProfile(false);
          }}
        />

        <div className="flex min-h-0 flex-1">
          {/* ---- Main pane ---- */}
          <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 lg:p-6 xl:overflow-hidden">
            {showProfile ? (
              <div className="mx-auto w-full max-w-6xl">
                <Button
                  variant="ghost"
                  size="sm"
                  className="mb-4 h-9 px-2 text-muted-foreground"
                  onClick={() => setShowProfile(false)}
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  Back to your search
                </Button>
                <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
                  <div className="flex flex-col gap-6 lg:col-span-2">
                    <Profile userType="renter" />
                    <FastTrackRequestsCard />
                  </div>
                  <div className="flex flex-col gap-6 lg:col-span-1">
                    <SubscriptionStatus
                      onUpgrade={() => setIsSubscriptionModalOpen(true)}
                      showHistory
                    />
                    <UsageMeter />
                  </div>
                </div>
              </div>
            ) : (
              <>
            <HubPreferenceBar onOpenSubscription={() => setIsSubscriptionModalOpen(true)} />

            <HubNewListings />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <HubModeTabs
                mode={mode}
                onChange={setMode}
                counts={{ matches: renterMatches.length }}
              />
            </div>

            <div className="min-h-0 flex-1 xl:overflow-y-auto">
              {/* Opens unfiltered: the whole verified set is the point of the
                  Browse tab, and preference-shaped results are what the AI tab
                  and the new-listings strip are for. */}
              {mode === 'browse' && <BrowseTable returnTo="/hub" embedded />}

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

              {mode === 'matches' && (user ? (
                <MatchesView userPreferences={preferences ?? undefined} userProfile={userProfile} />
              ) : (
                <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
                  <Heart className="h-8 w-8 text-primary" aria-hidden="true" />
                  <p className="font-serif text-xl">Keep the ones you like</p>
                  <p className="max-w-sm text-sm text-muted-foreground">
                    Sign in and every listing you save lands here, scored against what you're after.
                  </p>
                  <Button
                    className="mt-1"
                    onClick={() => navigate('/auth', { state: { returnTo: '/hub' } })}
                  >
                    Sign in
                  </Button>
                </div>
              ))}

              {/* The vetted-complex directory. Embedded, so profiles open in a
                  panel beside the chat and cards can be selected and asked
                  about, rather than navigating away. */}
              {mode === 'complexes' && <ComplexDirectory embedded />}

              {mode === 'map' && (
                <div className="pb-4">
                  {complexesLoading ? (
                    <div className="flex justify-center py-24">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
                    </div>
                  ) : (
                    <ComplexMapCanvas complexes={complexes ?? []} />
                  )}
                </div>
              )}
            </div>
              </>
            )}
          </main>

          {/* ---- Chat rail (xl and up) ---- */}
          {hasRail && (
            // Grows with the viewport rather than sitting at a fixed width: on
            // a 1920 screen a 420px column of chat next to 1300px of table
            // reads as an afterthought. Floor keeps it usable, ceiling stops it
            // eating the table's width on ultrawide.
            <aside className="flex w-[clamp(400px,30vw,560px)] shrink-0 flex-col border-l border-border bg-white/70 backdrop-blur-xl">
              <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
                <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
                <span className="font-serif text-base">AI chat</span>
              </div>
              <div className="min-h-0 flex-1">{chat}</div>
            </aside>
          )}
        </div>

        {/* ---- Chat dock (narrow viewports). Rendered instead of the rail, never
             alongside it - two mounted chats would be two conversations. ---- */}
        <div className={hasRail ? 'hidden' : 'shrink-0'}>
          {!hasRail && (
            <div
              className={`glass-card flex flex-col rounded-t-3xl transition-[height] duration-200 ${
                isChatOpen ? 'h-[70dvh]' : 'h-16'
              }`}
            >
              <button
                className="flex h-16 shrink-0 items-center gap-3 px-4 text-left"
                aria-expanded={isChatOpen}
                aria-controls="hub-chat-dock"
                onClick={() => setIsChatOpen((open) => !open)}
              >
                <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="font-serif text-base">AI chat</span>
                {!isChatOpen && (
                  <span className="truncate text-xs text-muted-foreground">
                    Ask about what&rsquo;s on screen
                  </span>
                )}
                {isChatOpen ? (
                  <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                ) : (
                  <ChevronUp className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
              </button>

              {/* Collapsing hides the chat, it never unmounts it - tearing down
                  HomeAI would take the conversation, the draft and the current
                  results with it. */}
              <div
                id="hub-chat-dock"
                className={`min-h-0 flex-1 ${isChatOpen ? '' : 'hidden'}`}
              >
                {chat}
              </div>
            </div>
          )}
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
