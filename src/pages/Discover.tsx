import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { OnboardingQuiz } from '@/components/OnboardingQuiz';
import { SwipeInterface } from '@/components/SwipeInterface';
import { MatchesView } from '@/components/MatchesView';
import { HomeAI } from '@/components/HomeAI';
import { Navigation } from '@/components/Navigation';
import { RealtorDashboard } from '@/components/RealtorDashboard';
import { RealtorNavigation } from '@/components/RealtorNavigation';
import { UserTypeSelector } from '@/components/UserTypeSelector';
import { HaustoChat } from '@/components/HaustoChat';
import { BrowseTable } from '@/components/BrowseTable';
import { FastTrackRequestsCard } from '@/components/FastTrackRequestsCard';
import { FloatingAIButton } from '@/components/FloatingAIButton';
import { Profile } from '@/components/Profile';
import { RealtorProfile } from '@/components/RealtorProfile';
import { CurrencyProvider } from '@/contexts/CurrencyContext';
import { useAuth } from '@/hooks/useAuth';
import { PropertyUploadModal } from '@/components/PropertyUploadModal';
import { SubscriptionModal } from '@/components/SubscriptionModal';
import { UsageMeter } from '@/components/UsageMeter';
import { SubscriptionStatus } from '@/components/SubscriptionStatus';
import { Loader2 } from 'lucide-react';
import { UserPreferences } from '@/types';
import { useUserRoles } from '@/hooks/useUserRoles';
import { useMatches } from '@/hooks/useMatches';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { dbToPreferences, preferencesToSearchQuery, hasMeaningfulPreferences } from '@/lib/preferences';
import { toast } from 'sonner';
const Discover = () => {
  const {
    user,
    loading
  } = useAuth();
  const { isRealtor, isLoading: rolesLoading } = useUserRoles();
  // DB-backed matches are the single source of truth for badge counts, so the
  // renter/realtor nav badges stay in sync with what MatchesView actually shows.
  const { renterMatches, realtorMatches: realtorMatchesDb } = useMatches();
  const location = useLocation();
  const navigate = useNavigate();

  // Unresolved renter-question count for the chat launcher badge (realtors)
  const { data: pendingQuestions = 0 } = useQuery({
    queryKey: ['fab-pending-questions', user?.id],
    enabled: !!user?.id && isRealtor,
    refetchInterval: 30000,
    queryFn: async () => {
      const { count } = await supabase
        .from('concierge_escalations')
        .select('id', { count: 'exact', head: true })
        .eq('realtor_id', user!.id)
        .eq('status', 'pending');
      return count || 0;
    },
  });
  const [userType, setUserType] = useState<'renter' | 'realtor' | null>(null);

  const [currentView, setCurrentView] = useState<'onboarding' | 'ai-chat' | 'swipe' | 'matches' | 'dashboard' | 'profile' | 'browse'>('ai-chat');
  const [userPreferences, setUserPreferences] = useState<UserPreferences | null>(null);
  const [isAIChatOpen, setIsAIChatOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isSubscriptionModalOpen, setIsSubscriptionModalOpen] = useState(false);
  // One-shot seed query for the quiz → AI-search handoff.
  const [aiSeedQuery, setAiSeedQuery] = useState<string | undefined>(undefined);
  // Gates the renter view until we know whether they have saved preferences
  // (so brand-new renters land in the quiz without an ai-chat flash first).
  const [prefsResolved, setPrefsResolved] = useState(false);

  // Redirect to home if not authenticated
  useEffect(() => {
    if (!loading && !user) {
      navigate('/');
    }
  }, [user, loading, navigate]);

  // Load saved preferences from localStorage and default to renter
  useEffect(() => {
    if (!user || rolesLoading) return;
    const savedUserType = localStorage.getItem(`userType_${user.id}`);
    const savedPreferences = localStorage.getItem(`userPreferences_${user.id}`);

    // Force renter if stored type is realtor but role missing
    const effectiveType: 'renter' | 'realtor' =
      savedUserType === 'realtor' && isRealtor ? 'realtor' : 'renter';
    setUserType(effectiveType);
    localStorage.setItem(`userType_${user.id}`, effectiveType);

    if (effectiveType === 'realtor') {
      setPrefsResolved(true);
      setCurrentView('dashboard');
      return;
    }

    // Hydrate preferences: localStorage first (instant), then reconcile with the
    // DB so they follow the user across devices even if localStorage is empty.
    // Brand-new renters (no prefs anywhere) are routed straight into the quiz.
    let localPrefs: UserPreferences | null = null;
    if (savedPreferences) {
      try {
        localPrefs = JSON.parse(savedPreferences);
        setUserPreferences(localPrefs);
      } catch (error) {
        console.error('Error parsing saved preferences:', error);
      }
    }
    // Deep link (?view=browse) wins over the default ai-chat view; without the
    // guard the async DB reconciliation below would override it back.
    const wantsBrowse = new URLSearchParams(location.search).get('view') === 'browse';
    const defaultView = wantsBrowse ? 'browse' : 'ai-chat';
    if (localPrefs && hasMeaningfulPreferences(localPrefs)) {
      // Returning renter — no need to wait on the DB to pick a view.
      setCurrentView(defaultView);
      setPrefsResolved(true);
    }
    (async () => {
      const { data: prefRow } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      const dbPrefs = dbToPreferences(prefRow as any);
      if (dbPrefs && hasMeaningfulPreferences(dbPrefs)) {
        setUserPreferences(dbPrefs);
        localStorage.setItem(`userPreferences_${user.id}`, JSON.stringify(dbPrefs));
        setCurrentView(defaultView);
      } else if (!(localPrefs && hasMeaningfulPreferences(localPrefs))) {
        // Nothing saved anywhere → force onboarding for this new renter.
        setCurrentView('onboarding');
      }
      setPrefsResolved(true);
    })();
  }, [user, rolesLoading, isRealtor]);

  // Deep link: /discover?view=browse (e.g. from the landing table preview)
  // overrides the default view once preferences resolve.
  useEffect(() => {
    if (!prefsResolved || userType !== 'renter') return;
    if (new URLSearchParams(location.search).get('view') === 'browse') {
      setCurrentView('browse');
    }
  }, [prefsResolved, userType, location.search]);
  useEffect(() => {
    // Listen for AI chat opening event from SwipeInterface
    const handleOpenAIChat = () => {
      setIsAIChatOpen(true);
    };

    // Listen for subscription modal opening event
    const handleOpenSubscriptionModal = (event: CustomEvent) => {
      setIsSubscriptionModalOpen(true);
    };

    // Listen for AI chat switch event from SwipeInterface
    const handleSwitchToAIChat = () => {
      setCurrentView('ai-chat');
    };
    window.addEventListener('openAIChat', handleOpenAIChat);
    window.addEventListener('openSubscriptionModal', handleOpenSubscriptionModal as EventListener);
    window.addEventListener('switchToAIChat', handleSwitchToAIChat);
    return () => {
      window.removeEventListener('openAIChat', handleOpenAIChat);
      window.removeEventListener('openSubscriptionModal', handleOpenSubscriptionModal as EventListener);
      window.removeEventListener('switchToAIChat', handleSwitchToAIChat);
    };
  }, []);
  const handleUserTypeSelect = (type: 'renter' | 'realtor') => {
    if (type === 'realtor' && !isRealtor) {
      toast.info('Realtor access required', {
        description: 'Submit an application to get realtor access.',
      });
      navigate('/realtor/apply');
      return;
    }
    setUserType(type);
    if (user) {
      localStorage.setItem(`userType_${user.id}`, type);
    }
    if (type === 'realtor') {
      setCurrentView('dashboard');
    } else {
      if (user) {
        const savedPreferences = localStorage.getItem(`userPreferences_${user.id}`);
        if (savedPreferences) {
          try {
            setUserPreferences(JSON.parse(savedPreferences));
            setCurrentView('ai-chat');
          } catch (error) {
            console.error('Error parsing saved preferences:', error);
            setCurrentView('ai-chat');
          }
        } else {
          setCurrentView('ai-chat');
        }
      } else {
        setCurrentView('ai-chat');
      }
    }
  };
  const handleOnboardingComplete = (preferences: UserPreferences) => {
    setUserPreferences(preferences);
    // Save preferences to localStorage
    if (user) {
      localStorage.setItem(`userPreferences_${user.id}`, JSON.stringify(preferences));
    }
    // Hand off straight into the AI search, pre-seeded with what they just told us,
    // so the quiz flows naturally into results instead of a cold swipe deck.
    setAiSeedQuery(preferencesToSearchQuery(preferences));
    setCurrentView('ai-chat');
  };
  const handleRestartOnboarding = () => {
    setUserPreferences(null);
    // Clear saved preferences
    if (user) {
      localStorage.removeItem(`userPreferences_${user.id}`);
    }
    setCurrentView('onboarding');
  };
  const switchUserType = () => {
    const newType = userType === 'renter' ? 'realtor' : 'renter';
    if (newType === 'realtor' && !isRealtor) {
      toast.info('Realtor access required', {
        description: 'Submit an application to get realtor access.',
      });
      navigate('/realtor/apply');
      return;
    }
    setUserType(newType);
    if (user) {
      localStorage.setItem(`userType_${user.id}`, newType);
    }
    if (newType === 'realtor') {
      setCurrentView('dashboard');
    } else {
      // Restore saved preferences if available
      if (user) {
        const savedPreferences = localStorage.getItem(`userPreferences_${user.id}`);
        if (savedPreferences) {
          try {
            setUserPreferences(JSON.parse(savedPreferences));
          } catch (error) {
            console.error('Error parsing saved preferences:', error);
          }
        }
      }
      setCurrentView('ai-chat');
    }
  };
  // Hold the renter view until we know whether they have saved preferences,
  // so brand-new renters go straight to the quiz without an ai-chat flash.
  if (loading || rolesLoading || (userType === 'renter' && !prefsResolved)) {
    return <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-orange-500" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>;
  }

  // Redirect to home if not authenticated
  if (!user) {
    return null;
  }
  return <CurrencyProvider>
      <Helmet>
        <title>Discover Rentals — Hausto AI Property Search</title>
        <meta name="description" content="Discover rental apartments in Vietnam. Chat with AI, swipe through curated listings, and match with homes that fit your vibe." />
        <link rel="canonical" href="https://hausto.lovable.app/discover" />
        <meta property="og:title" content="Discover Rentals on Hausto" />
        <meta property="og:description" content="Chat with AI and swipe through curated rental listings in Vietnam." />
        <meta property="og:url" content="https://hausto.lovable.app/discover" />
      </Helmet>
      <div className="h-screen overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100">
        <h1 className="sr-only">Discover Rental Apartments in Vietnam with Hausto</h1>
        {userType && currentView !== 'onboarding' && currentView !== 'dashboard' && !(userType === 'realtor' && currentView === 'profile') && <Navigation
          currentView={currentView}
          setCurrentView={view => {
            if (view === 'profile') {
              setCurrentView('profile');
            } else if (view === 'ai-chat') {
              setCurrentView('ai-chat');
            } else {
              setCurrentView(view as 'swipe' | 'matches' | 'browse');
            }
          }}
          matchCount={renterMatches.length}
          userType={userType}
          onSwitchUserType={switchUserType}
          onOpenAIChat={() => setCurrentView('ai-chat')}
          onRestartOnboarding={userType === 'renter' ? handleRestartOnboarding : undefined}
        />}

        {userType === 'realtor' && (currentView === 'dashboard' || currentView === 'profile') && <RealtorNavigation currentView={currentView as 'dashboard' | 'profile'} setCurrentView={view => setCurrentView(view)} matchCount={realtorMatchesDb.length} onSwitchUserType={switchUserType} onOpenAIChat={() => setIsAIChatOpen(true)} onAddProperty={() => setIsUploadModalOpen(true)} />}

        <main className="h-full overflow-y-auto pt-14">
          {currentView === 'ai-chat' && userType && <div className="container mx-auto px-4 pt-4">
              <h2 className="text-2xl mt-4 mb-8 text-center text-inherit font-serif font-normal">Describe Your Dream Home</h2>
            </div>}
          
          {currentView === 'swipe' && userType && <div className="container mx-auto px-4 pt-4">
              <h2 className="text-2xl mt-4 mb-4 text-center text-inherit font-serif font-normal">Swipe & Vibe</h2>
            </div>}
        
          {!userType && <UserTypeSelector onSelect={handleUserTypeSelect} />}
          
          {userType === 'renter' && currentView === 'onboarding' && <OnboardingQuiz onComplete={handleOnboardingComplete} onSkip={() => setCurrentView('ai-chat')} />}
          
          {userType === 'renter' && currentView === 'swipe' && <SwipeInterface userPreferences={userPreferences} onMatch={() => {
          // No-op: SwipeInterface persists the match via useMatches.createMatch,
          // and the nav badge derives its count from that same DB query.
        }} userProfile={{
          name: user.user_metadata?.name || '',
          email: user.email || '',
          phone: user.user_metadata?.phone || ''
        }} onRestartOnboarding={handleRestartOnboarding} />}
          
          {userType === 'renter' && currentView === 'browse' && <div className="container mx-auto px-4 pt-4 pb-12 max-w-6xl">
              <h2 className="text-2xl mt-4 mb-2 text-center text-inherit font-serif font-normal">Browse All Listings</h2>
              <p className="text-sm text-muted-foreground text-center mb-6">
                Verified inventory - duplicates merged, dead listings removed.
              </p>
              <BrowseTable returnTo="/discover" />
            </div>}

          {userType === 'renter' && currentView === 'matches' && <MatchesView userPreferences={userPreferences} userProfile={{
          name: user.user_metadata?.name || '',
          email: user.email || '',
          phone: user.user_metadata?.phone || ''
        }} />}

          {currentView === 'profile' && userType && (userType === 'realtor' ? <RealtorProfile /> : <div className="container mx-auto px-4 py-6 max-w-6xl">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                  {/* Left column (wider): Profile info + Preferences */}
                  <div className="lg:col-span-2 flex flex-col gap-6">
                    <Profile userType={userType} />
                    <FastTrackRequestsCard />
                  </div>
                  {/* Right column (narrower): Subscription + Usage */}
                  <div className="lg:col-span-1 flex flex-col gap-6">
                    <SubscriptionStatus onUpgrade={() => setIsSubscriptionModalOpen(true)} showHistory={true} />
                    <UsageMeter />
                  </div>
                </div>
              </div>)}

          {currentView === 'ai-chat' && userType && <HomeAI
            userPreferences={userPreferences ?? undefined}
            initialQuery={aiSeedQuery}
            onInitialQueryConsumed={() => setAiSeedQuery(undefined)}
          />}

          {userType === 'realtor' && currentView === 'dashboard' && <RealtorDashboard onSwitchUserType={switchUserType} onViewProfile={() => setCurrentView('profile')} onOpenUploadModal={() => setIsUploadModalOpen(true)} />}
        </main>

        {/* Realtors keep the bottom-right launcher for their renter message
            threads; renters use the platform-wide AI assistant (bottom-left)
            and reach match conversations from the Matches view. */}
        {userType === 'realtor' && (currentView === 'dashboard' || currentView === 'profile') && <FloatingAIButton onClick={() => setIsAIChatOpen(true)} badgeCount={pendingQuestions} />}

        <HaustoChat isOpen={isAIChatOpen} onClose={() => setIsAIChatOpen(false)} userPreferences={userPreferences} userType={userType || 'renter'} />

        <PropertyUploadModal isOpen={isUploadModalOpen} onClose={() => setIsUploadModalOpen(false)} />

        <SubscriptionModal isOpen={isSubscriptionModalOpen} onClose={() => setIsSubscriptionModalOpen(false)} />
      </div>
    </CurrencyProvider>;
};
export default Discover;