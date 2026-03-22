import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { OnboardingQuiz } from '@/components/OnboardingQuiz';
import { SwipeInterface } from '@/components/SwipeInterface';
import { MatchesView } from '@/components/MatchesView';
import { HomeAI } from '@/components/HomeAI';
import { Navigation } from '@/components/Navigation';
import { RealtorDashboard } from '@/components/RealtorDashboard';
import { RealtorNavigation } from '@/components/RealtorNavigation';
import { UserTypeSelector } from '@/components/UserTypeSelector';
import { HaustoChat } from '@/components/HaustoChat';
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
import { UserPreferences, Apartment, Match } from '@/types';
const Discover = () => {
  const {
    user,
    loading
  } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [userType, setUserType] = useState<'renter' | 'realtor' | null>(null);

  const [currentView, setCurrentView] = useState<'onboarding' | 'ai-chat' | 'swipe' | 'matches' | 'dashboard' | 'profile'>('ai-chat');
  const [userPreferences, setUserPreferences] = useState<UserPreferences | null>(null);
  const [matches, setMatches] = useState<Apartment[]>([]);
  const [realtorMatches, setRealtorMatches] = useState<Match[]>([]);
  const [isAIChatOpen, setIsAIChatOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isSubscriptionModalOpen, setIsSubscriptionModalOpen] = useState(false);

  // Redirect to home if not authenticated
  useEffect(() => {
    if (!loading && !user) {
      navigate('/');
    }
  }, [user, loading, navigate]);

  // Load saved preferences from localStorage and default to renter
  useEffect(() => {
    if (user) {
      const savedUserType = localStorage.getItem(`userType_${user.id}`);
      const savedPreferences = localStorage.getItem(`userPreferences_${user.id}`);

      if (savedUserType) {
        setUserType(savedUserType as 'renter' | 'realtor');
        if (savedUserType === 'realtor') {
          setCurrentView('dashboard');
        } else if (savedPreferences) {
          try {
            const preferences = JSON.parse(savedPreferences);
            setUserPreferences(preferences);
            setCurrentView('ai-chat');
          } catch (error) {
            console.error('Error parsing saved preferences:', error);
            setCurrentView('ai-chat');
          }
        } else {
          setCurrentView('ai-chat');
        }
      } else {
        // Default to renter for new users
        setUserType('renter');
        localStorage.setItem(`userType_${user.id}`, 'renter');
        if (savedPreferences) {
          try {
            const preferences = JSON.parse(savedPreferences);
            setUserPreferences(preferences);
            setCurrentView('ai-chat');
          } catch (error) {
            console.error('Error parsing saved preferences:', error);
            setCurrentView('ai-chat');
          }
        } else {
          setCurrentView('ai-chat');
        }
      }
    }
  }, [user]);
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
    setUserType(type);
    if (user) {
      localStorage.setItem(`userType_${user.id}`, type);
    }
    if (type === 'realtor') {
      setCurrentView('dashboard');
    } else {
      // Auto skip to ai-chat if user has completed quiz before
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
    setCurrentView('ai-chat');
  };
  const handleRestartOnboarding = () => {
    setUserPreferences(null);
    // Clear saved preferences
    if (user) {
      localStorage.removeItem(`userPreferences_${user.id}`);
    }
    setCurrentView('onboarding');
    setMatches([]);
  };
  const handleMatch = (apartment: Apartment) => {
    setMatches(prev => [...prev, apartment]);

    // Simulate realtor match notification
    const newMatch: Match = {
      id: `match-${Date.now()}`,
      apartmentId: apartment.id,
      renterId: 'current-user',
      realtorId: apartment.realtor.id,
      timestamp: new Date(),
      apartment,
      renterPreferences: userPreferences!
    };
    setRealtorMatches(prev => [...prev, newMatch]);
  };
  const switchUserType = () => {
    const newType = userType === 'renter' ? 'realtor' : 'renter';
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
    setMatches([]);
    setRealtorMatches([]);
  };
  if (loading) {
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
      <div className="h-screen overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100">
        {userType && currentView !== 'onboarding' && currentView !== 'dashboard' && !(userType === 'realtor' && currentView === 'profile') && <Navigation
          currentView={currentView}
          setCurrentView={view => {
            if (view === 'profile') {
              setCurrentView('profile');
            } else if (view === 'ai-chat') {
              setCurrentView('ai-chat');
            } else {
              setCurrentView(view as 'swipe' | 'matches');
            }
          }}
          matchCount={matches.length}
          userType={userType}
          onSwitchUserType={switchUserType}
          onOpenAIChat={() => setCurrentView('ai-chat')}
          onRestartOnboarding={userType === 'renter' ? handleRestartOnboarding : undefined}
        />}

        {userType === 'realtor' && (currentView === 'dashboard' || currentView === 'profile') && <RealtorNavigation currentView={currentView as 'dashboard' | 'profile'} setCurrentView={view => setCurrentView(view)} matchCount={realtorMatches.length} onSwitchUserType={switchUserType} onOpenAIChat={() => setIsAIChatOpen(true)} onAddProperty={() => setIsUploadModalOpen(true)} />}

        <div className="h-full overflow-y-auto pt-14">
          {currentView === 'ai-chat' && userType && <div className="container mx-auto px-4 pt-4">
              <h2 className="text-2xl font-bold mt-4 mb-8 text-center text-inherit">Describe Your Dream Home</h2>
            </div>}
          
          {currentView === 'swipe' && userType && <div className="container mx-auto px-4 pt-4">
              <h2 className="text-2xl font-bold mt-4 mb-4 text-center text-inherit">Vibe & Find Your Home</h2>
            </div>}
        
          {!userType && <UserTypeSelector onSelect={handleUserTypeSelect} />}
          
          {userType === 'renter' && currentView === 'onboarding' && <OnboardingQuiz onComplete={handleOnboardingComplete} onSkip={() => setCurrentView('ai-chat')} />}
          
          {userType === 'renter' && currentView === 'swipe' && <SwipeInterface userPreferences={userPreferences} onMatch={handleMatch} userProfile={{
          name: user.user_metadata?.name || '',
          email: user.email || '',
          phone: user.user_metadata?.phone || ''
        }} onRestartOnboarding={handleRestartOnboarding} />}
          
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
                  </div>
                  {/* Right column (narrower): Subscription + Usage */}
                  <div className="lg:col-span-1 flex flex-col gap-6">
                    <SubscriptionStatus onUpgrade={() => setIsSubscriptionModalOpen(true)} showHistory={true} />
                    <UsageMeter />
                  </div>
                </div>
              </div>)}

          {currentView === 'ai-chat' && userType && <HomeAI />}

          {userType === 'realtor' && currentView === 'dashboard' && <RealtorDashboard onSwitchUserType={switchUserType} onViewProfile={() => setCurrentView('profile')} onOpenUploadModal={() => setIsUploadModalOpen(true)} />}
        </div>

        {userType && (currentView === 'swipe' || currentView === 'matches' || currentView === 'dashboard' || currentView === 'profile') && <FloatingAIButton onClick={() => setIsAIChatOpen(true)} />}

        <HaustoChat isOpen={isAIChatOpen} onClose={() => setIsAIChatOpen(false)} userPreferences={userPreferences} userType={userType || 'renter'} />

        <PropertyUploadModal isOpen={isUploadModalOpen} onClose={() => setIsUploadModalOpen(false)} />

        <SubscriptionModal isOpen={isSubscriptionModalOpen} onClose={() => setIsSubscriptionModalOpen(false)} />
      </div>
    </CurrencyProvider>;
};
export default Discover;