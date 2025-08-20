
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Heart, MessageSquare, User, Users } from 'lucide-react';
import { CurrencyDropdown } from '@/components/CurrencyDropdown';
import { UserMenu } from '@/components/UserMenu';

interface NavigationProps {
  currentView: 'swipe' | 'matches' | 'profile' | 'feed';
  setCurrentView: (view: 'swipe' | 'matches' | 'profile' | 'feed') => void;
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
  return (
    <nav className="fixed top-0 left-0 right-0 z-40 bg-white/80 backdrop-blur-md border-b border-gray-200">
      <div className="max-w-4xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <h1 className="text-xl font-bold bg-gradient-to-r from-orange-600 to-red-600 bg-clip-text text-transparent">
              Hausto
            </h1>
          </div>
          
          <div className="flex items-center justify-center flex-1">
            <div className="flex items-center space-x-0.5 md:space-x-1">
              <Button
                variant={currentView === 'swipe' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setCurrentView('swipe')}
                className={`text-xs md:text-sm px-2 md:px-3 ${currentView === 'swipe' ? 'bg-primary text-primary-foreground' : ''}`}
              >
                <Heart className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
                <span className="hidden sm:inline">Discover</span>
              </Button>
              
              <Button
                variant={currentView === 'matches' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setCurrentView('matches')}
                className={`relative text-xs md:text-sm px-2 md:px-3 ${currentView === 'matches' ? 'bg-primary text-primary-foreground' : ''}`}
              >
                <MessageSquare className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
                <span className="hidden sm:inline">Matches</span>
                {matchCount > 0 && (
                  <Badge className="ml-1 bg-primary text-primary-foreground text-xs h-4 min-w-4 flex items-center justify-center rounded-full">
                    {matchCount}
                  </Badge>
                )}
              </Button>
              
              
            </div>
          </div>

          <div className="flex items-center">
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
