import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { OnboardingQuiz } from '@/components/OnboardingQuiz';
import { SwipeInterface } from '@/components/SwipeInterface';
import { MatchesView } from '@/components/MatchesView';
import { AIChatView } from '@/components/AIChatView';
import { Navigation } from '@/components/Navigation';
import { RealtorDashboard } from '@/components/RealtorDashboard';
import { RealtorNavigation } from '@/components/RealtorNavigation';
import { UserTypeSelector } from '@/components/UserTypeSelector';
import { AIChatAgent } from '@/components/AIChatAgent';
import { FloatingAIButton } from '@/components/FloatingAIButton';
import { Profile } from '@/components/Profile';
import { RealtorProfile } from '@/components/RealtorProfile';
import { SocialFeed } from '@/components/SocialFeed';
import { CurrencyProvider } from '@/contexts/CurrencyContext';
import { useAuth } from '@/hooks/useAuth';
import { PropertyUploadModal } from '@/components/PropertyUploadModal';
import { SubscriptionModal } from '@/components/SubscriptionModal';
import { UsageMeter } from '@/components/UsageMeter';
import { SubscriptionStatus } from '@/components/SubscriptionStatus';
import { Loader2 } from 'lucide-react';
import { UserPreferences, Apartment, Match } from '@/types';

const Discover = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [userType, setUserType] = useState<'renter' | 'realtor' | null>(null);

  // Check if user is admin
  const isAdmin = user?.email === 'ted.ngz@gmail.com';
  const [currentView, setCurrentView] = useState<'onboarding' | 'ai-chat' | 'swipe' | 'matches' | 'dashboard' | 'profile' | 'feed'>('ai-chat');
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

  // Load saved preferences from localStorage
  useEffect(() => {
    if (user) {
      const savedUserType = localStorage.getItem(`userType_${user.id}`);
      const savedPreferences = localStorage.getItem(`userPreferences_${user.id}`);
      
      // Force non-admin users to renter flow
      if (!isAdmin && savedUserType === 'realtor') {
        localStorage.removeItem(`userType_${user.id}`);
        setUserType('renter');
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
        return;
      }
      
      if (savedUserType && (savedUserType === 'renter' || isAdmin)) {
        setUserType(savedUserType as 'renter' | 'realtor');
        
        if (savedUserType === 'realtor' && isAdmin) {
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
      } else if (!isAdmin) {
        // Auto-set non-admin users as renters
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
  }, [user, isAdmin]);

  useEffect(() => {
    // Listen for AI chat opening event from SwipeInterface
    const handleOpenAIChat = () => {
      setIsAIChatOpen(true);
    };

    // Listen for subscription modal opening event
    const handleOpenSubscriptionModal = (event: CustomEvent) => {
      setIsSubscriptionModalOpen(true);
    };

    window.addEventListener('openAIChat', handleOpenAIChat);
    window.addEventListener('openSubscriptionModal', handleOpenSubscriptionModal as EventListener);
    return () => {
      window.removeEventListener('openAIChat', handleOpenAIChat);
      window.removeEventListener('openSubscriptionModal', handleOpenSubscriptionModal as EventListener);
    };
  }, []);

  const handleUserTypeSelect = (type: 'renter' | 'realtor') => {
    // Only allow admin to select realtor
    if (type === 'realtor' && !isAdmin) {
      type = 'renter';
    }
    
    setUserType(type);
    if (user) {
      localStorage.setItem(`userType_${user.id}`, type);
    }
    
    if (type === 'realtor' && isAdmin) {
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
    // Only allow admin to switch to realtor
    if (!isAdmin) {
      setUserType('renter');
      setCurrentView('ai-chat');
      if (user) {
        localStorage.setItem(`userType_${user.id}`, 'renter');
      }
      return;
    }
    
    setUserType(null);
    setCurrentView('onboarding');
    setUserPreferences(null);
    setMatches([]);
    setRealtorMatches([]);
    
    // Clear localStorage
    if (user) {
      localStorage.removeItem(`userType_${user.id}`);
      localStorage.removeItem(`userPreferences_${user.id}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-orange-500" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Redirect to home if not authenticated
  if (!user) {
    return null;
  }

  return (
    <CurrencyProvider>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
        {userType && currentView !== 'onboarding' && currentView !== 'dashboard' && !(userType === 'realtor' && currentView === 'profile') && (
          <Navigation 
            currentView={currentView}
            setCurrentView={(view) => {
              if (view === 'profile') {
                setCurrentView('profile');
              } else if (view === 'feed') {
                setCurrentView('feed');
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
            isAdmin={isAdmin}
          />
        )}

        {userType === 'realtor' && isAdmin && (currentView === 'dashboard' || currentView === 'profile') && (
          <RealtorNavigation
            currentView={currentView as 'dashboard' | 'profile'}
            setCurrentView={(view) => setCurrentView(view)}
            matchCount={realtorMatches.length}
            onSwitchUserType={switchUserType}
            onOpenAIChat={() => setIsAIChatOpen(true)}
            onAddProperty={() => setIsUploadModalOpen(true)}
          />
        )}
        
        {!userType && isAdmin && (
          <UserTypeSelector onSelect={handleUserTypeSelect} />
        )}
        
        {userType === 'renter' && currentView === 'onboarding' && (
          <OnboardingQuiz 
            onComplete={handleOnboardingComplete} 
            onSkip={() => setCurrentView('ai-chat')}
          />
        )}
        
        {userType === 'renter' && currentView === 'swipe' && userPreferences && (
          <SwipeInterface 
            userPreferences={userPreferences}
            onMatch={handleMatch}
            userProfile={{ name: user.user_metadata?.name || '', email: user.email || '', phone: user.user_metadata?.phone || '' }}
            onRestartOnboarding={handleRestartOnboarding}
          />
        )}
        
        {userType === 'renter' && currentView === 'matches' && (
          <MatchesView 
            userPreferences={userPreferences}
            userProfile={{ name: user.user_metadata?.name || '', email: user.email || '', phone: user.user_metadata?.phone || '' }}
          />
        )}

        {currentView === 'profile' && userType && (
          userType === 'realtor' && isAdmin ? (
            <RealtorProfile />
          ) : (
            <div className="space-y-6">
              <Profile userType={userType} />
              <div className="max-w-4xl mx-auto px-4 pb-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <UsageMeter />
                  <SubscriptionStatus 
                    onUpgrade={() => setIsSubscriptionModalOpen(true)} 
                    showHistory={true}
                  />
                </div>
              </div>
            </div>
          )
        )}

        {currentView === 'ai-chat' && userType && (
          <AIChatView showNavigation={true} userPreferences={userPreferences} />
        )}

        {currentView === 'feed' && userType && (
          <SocialFeed />
        )}

        {userType === 'realtor' && isAdmin && currentView === 'dashboard' && (
          <RealtorDashboard 
            onSwitchUserType={switchUserType}
            onViewProfile={() => setCurrentView('profile')}
            onOpenUploadModal={() => setIsUploadModalOpen(true)}
          />
        )}

        {userType && (currentView === 'swipe' || currentView === 'matches' || currentView === 'dashboard' || currentView === 'profile' || currentView === 'feed') && (
          <FloatingAIButton onClick={() => setIsAIChatOpen(true)} />
        )}

        <AIChatAgent 
          isOpen={isAIChatOpen}
          onClose={() => setIsAIChatOpen(false)}
          userPreferences={userPreferences}
          userType={userType || 'renter'}
        />

        <PropertyUploadModal 
          isOpen={isUploadModalOpen}
          onClose={() => setIsUploadModalOpen(false)}
        />

        <SubscriptionModal
          isOpen={isSubscriptionModalOpen}
          onClose={() => setIsSubscriptionModalOpen(false)}
        />
      </div>
    </CurrencyProvider>
  );
};

export default Discover;