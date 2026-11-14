import { useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Heart, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BrowseTable } from '@/components/BrowseTable';
import { MatchesView } from '@/components/MatchesView';
import { ComplexDirectory } from '@/components/ComplexDirectory';
import { ComplexMapCanvas } from '@/components/ComplexMapCanvas';
import { OnboardingQuiz } from '@/components/OnboardingQuiz';
import { Profile } from '@/components/Profile';
import { SubscriptionStatus } from '@/components/SubscriptionStatus';
import { UsageMeter } from '@/components/UsageMeter';
import { HomeAI } from '@/components/HomeAI';
import { ChatDock, RAIL_MIN_VIEWPORT } from '@/components/chat/ChatDock';
import { SubscriptionModal } from '@/components/SubscriptionModal';
import { HubNavigation } from '@/components/hub/HubNavigation';
import { HubModeTabs, type HubMode } from '@/components/hub/HubModeTabs';
import { ViewingRequestsPane } from '@/components/hub/ViewingRequestsPane';
import { HubNewListings } from '@/components/hub/HubNewListings';
import { ConciergeCaptureModal, type SearchPrefill } from '@/components/ConciergeCaptureModal';
import { CurrencyProvider } from '@/contexts/CurrencyContext';
import { useAuth } from '@/hooks/useAuth';
import { useComplexes } from '@/hooks/useComplexes';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { preferencesToSearchQuery } from '@/lib/preferences';
import { clearChatHandoff, peekChatHandoff } from '@/lib/chatHandoff';
import { ASSISTANT_COMPARE_EVENT, ASSISTANT_OPEN_EVENT } from '@/lib/assistantEvents';
import { DEEP_SCAN_EVENT } from '@/lib/deepScanEvents';
import { cn } from '@/lib/utils';
import { prioritySearchFromQuery } from '../../supabase/functions/_shared/viewing/place.ts';

/**
 * The hub: one screen for the three things renters were bouncing between.
 *
 * Desktop is two panes - a mode-switched main pane (browse table / AI results /
 * matches) and a docked Hausto Agent chat rail that never goes away. Narrower than
 * RAIL_MIN_VIEWPORT the rail collapses to a bar that opens as a sheet, because
 * the comparison table needs every pixel of width it can get.
 */
const Hub = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
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

  // Links from WhatsApp: `?tab=viewings` to pick other days for a request,
  // and `?priority=...` to start a Priority search filled in from one whose
  // places all fell through (deliver.ts). The search's parameters stay in the
  // address while its form is open - signing in comes back to it - and are
  // dropped once it closes, so a reload does not reopen it.
  const [linked] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return { viewings: params.get('tab') === 'viewings', priority: prioritySearchFromQuery(params) };
  });
  const [prioritySearch, setPrioritySearch] = useState<SearchPrefill | null>(linked.priority);
  const closePrioritySearch = () => {
    setPrioritySearch(null);
    navigate('/hub', { replace: true });
  };

  // A carried-over comparison opens on Browse, not AI: the side-by-side panel
  // belongs to the table, and the chat answers about it from the rail.
  const [mode, setMode] = useState<HubMode>(
    linked.viewings ? 'viewings' : handoff?.compareIds ? 'browse' : handoff ? 'ai' : 'browse',
  );
  // Profile is a full-pane detour rather than a tab - it is account admin, not
  // part of the search loop the tabs describe.
  const [showProfile, setShowProfile] = useState(false);
  // Set once the quiz is done or dismissed, so it does not reappear while the
  // saved preferences are still making their way back from the DB. A renter
  // who arrives mid-sentence from home starts skipped: the quiz would swallow
  // the message they just sent, and it is still one tap away in the nav menu.
  // So does one who followed a link here to do one particular thing.
  const [skippedOnboarding, setSkippedOnboarding] = useState(!!handoff || linked.viewings || !!linked.priority);
  // One-shot opening message - from the quiz, or carried over from home.
  const [seedQuery, setSeedQuery] = useState<string | undefined>(handoff?.query);
  const [seedImages, setSeedImages] = useState<File[] | undefined>(handoff?.images);
  // Read once by the chat when it mounts, so it is never cleared: crossing the
  // rail breakpoint remounts the chat, and the pins should survive that.
  const [seedSubjects] = useState(handoff?.subjects);
  const [seedCompareIds] = useState(handoff?.compareIds);
  // A Deep scan asked for from a card elsewhere, read here on arrival.
  const [seedDeepScan] = useState(handoff?.deepScan);
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
  // The chat's own controls (history, new chat) render into this node, so they
  // share the "Hausto Agent" heading's row instead of taking one of their own off
  // the top of the thread. Only ever one of the rail and the dock is mounted,
  // so only one of them ever claims it.
  const [chatHeaderPortal, setChatHeaderPortal] = useState<HTMLDivElement | null>(null);
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

  // A card's sparkle pins the listing to the chat and the compare button asks
  // about a shortlist outright. On the rail both land in a conversation that is
  // already on screen; in the dock they landed inside a collapsed bar, so the
  // gesture looked like it had done nothing and the reply arrived out of sight.
  // Opening the sheet is the missing half of "ask about this one".
  useEffect(() => {
    if (hasRail) return;
    const open = () => setIsChatOpen(true);
    window.addEventListener(ASSISTANT_OPEN_EVENT, open);
    window.addEventListener(ASSISTANT_COMPARE_EVENT, open);
    // A Deep scan is read in the chat, so asking for one has to open it too -
    // otherwise the scan is generated into a collapsed sheet and the press
    // looks like it did nothing.
    window.addEventListener(DEEP_SCAN_EVENT, open);
    return () => {
      window.removeEventListener(ASSISTANT_OPEN_EVENT, open);
      window.removeEventListener(ASSISTANT_COMPARE_EVENT, open);
      window.removeEventListener(DEEP_SCAN_EVENT, open);
    };
  }, [hasRail]);

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
        <div className="min-h-[var(--app-h)] bg-gradient-to-br from-slate-50 via-white to-slate-100">
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
      initialDeepScan={seedDeepScan}
      onInitialQueryConsumed={() => {
        setSeedQuery(undefined);
        setSeedImages(undefined);
      }}
      resultsPortal={resultsPortal}
      onResultsCountChange={setResultsCount}
      headerPortal={chatHeaderPortal}
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
        <link rel="canonical" href="https://www.hausto.com/hub" />
      </Helmet>

      {/* At rail widths, one screen: the nav, then the main pane and the chat
          rail side by side, each scrolling itself. Below them it is an
          ordinary page that scrolls, the nav stuck to the top and the chat
          pinned to the bottom of the screen over it (ChatDock's `pinned`) -
          a one-screen layout needs the screen's height, and Brave on iOS
          reports one that ends above its toolbar, leaving blank page under
          the chat. The floating panels still find both edges where they
          expect them: --hub-nav at the top, --hub-dock at the bottom. */}
      <div
        className={cn(
          'flex flex-col bg-gradient-to-br from-slate-50 via-white to-slate-100',
          hasRail ? 'h-[var(--app-h)] overflow-hidden' : 'min-h-[var(--app-h)]'
        )}
      >
        <h1 className="sr-only">Your rental search on Hausto</h1>
        <HubNavigation
          className={hasRail ? undefined : 'sticky top-0 z-40'}
          onViewProfile={() => setShowProfile(true)}
          onOpenSubscription={() => setIsSubscriptionModalOpen(true)}
          onRestartOnboarding={() => {
            clearPreferences();
            setSkippedOnboarding(false);
            setShowProfile(false);
          }}
        />

        <div className={cn('flex flex-1', hasRail && 'min-h-0')}>
          {/* ---- Main pane ---- */}
          {/* The search view carries its own inner scroller at xl, so the pane
              stops scrolling there - profile has none, so it keeps the pane's. */}
          {/* Below rail widths the page scrolls, not the pane, and the pane
              leaves room at its end for the chat sheet, however tall it is.
              Wide content (the browse table, the strips) scrolls sideways in
              its own box; the clip keeps anything else from widening the page. */}
          <main
            className={cn(
              'flex min-w-0 flex-1 flex-col',
              hasRail ? 'overflow-y-auto' : 'overflow-x-clip',
              hasRail && !showProfile && 'xl:overflow-hidden'
            )}
            style={hasRail || showProfile ? undefined : { paddingBottom: 'var(--hub-dock)' }}
          >
            {showProfile ? (
              <div className="mx-auto w-full max-w-6xl p-4 lg:p-6">
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
            {/* The pane's header. At xl it is the rail header's height, so the
                two hairlines meet as one line across the page. */}
            <HubModeTabs
              className="h-12 shrink-0 xl:h-14"
              mode={mode}
              onChange={setMode}
              counts={{ ai: resultsCount }}
              panelId="hub-panel"
            />

            {/* Below xl the whole pane scrolls, so this grows to its content
                rather than shrinking into the pane and spilling past its own
                bottom padding. */}
            <div className="flex flex-1 flex-col gap-4 p-4 lg:p-6 xl:min-h-0 xl:overflow-y-auto">
            {/* Under the tabs rather than over them: it belongs to no one tab,
                and here it scrolls away with the pane instead of holding a
                band of a short screen for good. */}
            <HubNewListings />

            <div
              id="hub-panel"
              role="tabpanel"
              aria-labelledby={`hub-tab-${mode}`}
              className="flex-1"
            >
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

              {mode === 'viewings' && <ViewingRequestsPane />}

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
            </div>
              </>
            )}
          </main>

          {/* ---- Chat rail (xl and up). The ceiling on its width is what the
               table needs rather than a round number - its 760px minimum plus
               the main pane's padding - so it only binds just above
               RAIL_MIN_VIEWPORT, where the two genuinely compete for width.

               Gone on the profile: account admin is not a conversation, and a
               chat rail beside a billing page is one more thing to ignore.
               Hidden rather than unmounted, so the thread, the draft and the
               pins are all still there on the way back. ---- */}
          {hasRail && (
            <ChatDock
              hasRail
              hidden={showProfile}
              isOpen={isChatOpen}
              onOpenChange={setIsChatOpen}
              onHeaderPortalChange={setChatHeaderPortal}
            >
              {chat}
            </ChatDock>
          )}
        </div>

        {/* ---- Chat dock (narrow viewports). Rendered instead of the rail,
             never alongside it - two mounted chats would be two
             conversations. ---- */}
        {!hasRail && (
          <ChatDock
            hasRail={false}
            hidden={showProfile}
            isOpen={isChatOpen}
            onOpenChange={setIsChatOpen}
            collapsedHint="Ask about what’s on screen"
            pinned
            onHeaderPortalChange={setChatHeaderPortal}
          >
            {chat}
          </ChatDock>
        )}

        <SubscriptionModal
          isOpen={isSubscriptionModalOpen}
          onClose={() => setIsSubscriptionModalOpen(false)}
        />

        {/* From a WhatsApp link: signed out it asks for a sign-in, without the
            Pass it pitches the Pass, and with it the form, filled in. */}
        {linked.priority && (
          <ConciergeCaptureModal
            open={!!prioritySearch}
            onOpenChange={open => { if (!open) closePrioritySearch(); }}
            search={linked.priority}
          />
        )}
      </div>
    </CurrencyProvider>
  );
};

export default Hub;
