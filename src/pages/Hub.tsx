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
import { clearChatHandoff, peekChatHandoff } from '@/lib/chatHandoff';

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

  // A renter who typed into the landing page's composer arrives with their
  // message parked, not sent (see lib/chatHandoff). Read during the first
  // render so the page opens in the shape that message needs - AI tab, chat
  // open - and dropped in an effect once this instance owns it, so a later
  // visit to the hub doesn't replay it.
  const [handoff] = useState(peekChatHandoff);
  useEffect(() => {
    clearChatHandoff();
  }, []);

  // A carried-over comparison opens on Browse, not AI: the side-by-side panel
  // belongs to the table, and the chat answers about it from the rail.
  const [mode, setMode] = useState<HubMode>(
    handoff?.compareIds ? 'browse' : handoff ? 'ai' : 'browse',
  );
  // Profile is a full-pane detour rather than a tab - it is account admin, not
  // part of the search loop the tabs describe.
  const [showProfile, setShowProfile] = useState(false);
  // Set once the quiz is done or dismissed, so it does not reappear while the
  // saved preferences are still making their way back from the DB. A renter
  // who arrives mid-sentence from home starts skipped: the quiz would swallow
  // the message they just sent, and it is still one tap away in the nav menu.
  const [skippedOnboarding, setSkippedOnboarding] = useState(!!handoff);
  // One-shot opening message - from the quiz, or carried over from home.
  const [seedQuery, setSeedQuery] = useState<string | undefined>(handoff?.query);
  const [seedImages, setSeedImages] = useState<File[] | undefined>(handoff?.images);
  // Read once by the chat when it mounts, so it is never cleared: crossing the
  // rail breakpoint remounts the chat, and the pins should survive that.
  const [seedSubjects] = useState(handoff?.subjects);
  const [seedCompareIds] = useState(handoff?.compareIds);
  // Set while either pane has a compare panel up. Both live inside a pane that
  // is only mounted while its tab is active, so switching tabs closes them.
  const [isComparing, setIsComparing] = useState(false);
  const [isSubscriptionModalOpen, setIsSubscriptionModalOpen] = useState(false);
  // Narrow viewports get the chat as a sheet rather than a column. Open from
  // the start for a handed-over message, which is a conversation already in
  // progress - collapsed, the reply would arrive behind a closed dock.
  const [isChatOpen, setIsChatOpen] = useState(!!handoff);
  // The chat renders its listings into this node. Held in state rather than a
  // ref so the first render after it mounts actually reaches HomeAI.
  const [resultsPortal, setResultsPortal] = useState<HTMLDivElement | null>(null);
  const [resultsCount, setResultsCount] = useState(0);
  // A search finishing while the renter is on another tab shouldn't yank them
  // away, but the first one should - otherwise their results land off-screen.
  const hasSeenResults = useRef(false);

  useEffect(() => {
    if (resultsCount === 0 || hasSeenResults.current) return;
    hasSeenResults.current = true;
    // Not while a comparison is open. Those results are usually the answer to
    // the comparison itself, and switching tabs to show them would unmount the
    // panel being compared - the chat's reply is already in the rail, so the
    // renter loses nothing by staying put.
    if (isComparing) return;
    setMode('ai');
  }, [resultsCount, isComparing]);

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
      initialImages={seedImages}
      initialSubjects={seedSubjects}
      onInitialQueryConsumed={() => {
        setSeedQuery(undefined);
        setSeedImages(undefined);
      }}
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
              {mode === 'browse' && (
                <BrowseTable
                  returnTo="/hub"
                  embedded
                  initialCompareIds={seedCompareIds}
                  onCompareOpenChange={setIsComparing}
                />
              )}

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
              {mode === 'complexes' && (
                <ComplexDirectory embedded onCompareOpenChange={setIsComparing} />
              )}

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
            // A third of the viewport, the same share the dock takes on a
            // phone or tablet. The ceiling is what the table needs rather than
            // a round number - its 760px minimum plus the main pane's padding
            // - so it only binds just above RAIL_MIN_VIEWPORT, where the two
            // genuinely compete for width. A fixed 560px ceiling instead left
            // the chat at 22% of a 2560 screen, an afterthought beside 1240px
            // of table slack, which is what growing with the viewport was
            // supposed to avoid.
            //
            // The width itself is --hub-rail (src/index.css): every floating
            // surface on this page positions itself against the same value,
            // and it used to be spelled out in two files that disagreed.
            <aside className="flex w-[var(--hub-rail)] shrink-0 flex-col border-l border-border bg-white/70 backdrop-blur-xl">
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
                // A third of the viewport, not two thirds: on a phone the dock
                // used to bury whatever the renter was asking about, so the
                // answer arrived with no way to see what it referred to. The
                // 15rem floor is the composer plus one line of reply - below
                // that the sheet is open but useless.
                isChatOpen ? 'h-[max(33dvh,15rem)]' : 'h-16'
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
