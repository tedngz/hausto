
import { Button } from '@/components/ui/button';
import { Heart, MessageSquare, User, Users, Sparkles, Search, LayoutList } from 'lucide-react';
import { CurrencyDropdown } from '@/components/CurrencyDropdown';
import { UserMenu } from '@/components/UserMenu';
import { useNavigate } from 'react-router-dom';

interface NavigationProps {
  currentView: 'swipe' | 'matches' | 'profile' | 'ai-chat' | 'browse';
  setCurrentView: (view: 'swipe' | 'matches' | 'profile' | 'ai-chat' | 'browse') => void;
  matchCount: number;
  userType: 'renter' | 'realtor';
  onSwitchUserType: () => void;
  onOpenAIChat: () => void;
  onRestartOnboarding?: () => void;
}

export const Navigation = ({ 
  currentView, 
  setCurrentView, 
  matchCount, 
  userType, 
  onSwitchUserType,
  onOpenAIChat,
  onRestartOnboarding
}: NavigationProps) => {
  const navigate = useNavigate();
  return (
    <nav className="fixed top-0 left-0 right-0 z-40 bg-white/80 backdrop-blur-md border-b border-gray-200">
      <div className="max-w-4xl mx-auto px-3 md:px-4 py-2 md:py-3">
        <div className="flex items-center justify-between relative">
          <div className="flex items-center min-w-0 z-10">
            <div
              className="flex items-center justify-center gap-1.5 md:gap-2 cursor-pointer"
              onClick={() => navigate('/')}
            >
              <img
                src="/lovable-uploads/15e7e5a0-a35d-46c1-b0ba-9e273a963e39.png"
                alt="Hausto Logo"
                className="w-6 h-6 md:w-6 md:h-6"
              />
              {/* Wordmark hidden on mobile so the centered nav icons never overlap it */}
              <h1 className="hidden sm:block text-lg md:text-xl font-bold bg-gradient-to-r from-orange-600 to-red-600 bg-clip-text text-transparent">
                Hausto
              </h1>
            </div>
          </div>

          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex items-center gap-1 sm:gap-3 pointer-events-auto">
              <Button
                variant={currentView === 'ai-chat' ? 'default' : 'ghost'}
                size="icon"
                onClick={() => setCurrentView('ai-chat')}
                aria-label="AI chat"
                className={`h-9 w-9 sm:h-10 sm:w-10 shrink-0 ${currentView === 'ai-chat' ? 'bg-primary text-primary-foreground' : ''}`}
              >
                <Sparkles className="w-5 h-5" aria-hidden="true" />
              </Button>
              
              <Button
                variant={currentView === 'browse' ? 'default' : 'ghost'}
                size="icon"
                onClick={() => setCurrentView('browse')}
                aria-label="Browse all listings"
                className={`h-9 w-9 sm:h-10 sm:w-10 shrink-0 ${currentView === 'browse' ? 'bg-primary text-primary-foreground' : ''}`}
              >
                <LayoutList className="w-5 h-5" aria-hidden="true" />
              </Button>

              <Button
                variant={currentView === 'swipe' ? 'default' : 'ghost'}
                size="icon"
                onClick={() => setCurrentView('swipe')}
                aria-label="Swipe properties"
                className={`h-9 w-9 sm:h-10 sm:w-10 shrink-0 ${currentView === 'swipe' ? 'bg-primary text-primary-foreground' : ''}`}
              >
                <Search className="w-5 h-5" aria-hidden="true" />
              </Button>
              
              <Button
                variant={currentView === 'matches' ? 'default' : 'ghost'}
                size="icon"
                onClick={() => setCurrentView('matches')}
                aria-label={`View matches${matchCount > 0 ? ` (${matchCount})` : ''}`}
                className={`relative h-9 w-9 sm:h-10 sm:w-10 shrink-0 ${currentView === 'matches' ? 'bg-primary text-primary-foreground' : ''}`}
              >
                <Heart className="w-5 h-5" aria-hidden="true" />
                {matchCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-semibold border-2 border-white leading-none">
                    {matchCount > 99 ? '99+' : matchCount}
                  </span>
                )}
              </Button>
            </div>
          </div>

          <div className="flex items-center min-w-0 z-10">
            <UserMenu 
              userType={userType}
              onSwitchUserType={onSwitchUserType}
              onRestartOnboarding={onRestartOnboarding}
              onViewProfile={() => setCurrentView('profile')}
            />
          </div>
        </div>
      </div>
    </nav>
  );
};
