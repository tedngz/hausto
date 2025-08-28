
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Heart, MessageSquare, User, Users, Sparkles } from 'lucide-react';
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
  isAdmin?: boolean;
}

export const Navigation = ({ 
  currentView, 
  setCurrentView, 
  matchCount, 
  userType, 
  onSwitchUserType,
  onOpenAIChat,
  onRestartOnboarding,
  isAdmin = false
}: NavigationProps) => {
  return (
    <nav className="fixed top-0 left-0 right-0 z-40 bg-white/80 backdrop-blur-md border-b border-gray-200">
      <div className="max-w-4xl mx-auto px-3 md:px-4 py-2 md:py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center min-w-0">
            <div className="flex items-center justify-center space-x-1.5 md:space-x-2">
              <img 
                src="/lovable-uploads/15e7e5a0-a35d-46c1-b0ba-9e273a963e39.png" 
                alt="Hausto Logo" 
                className="w-5 h-5 md:w-6 md:h-6"
              />
              <h1 className="text-lg md:text-xl font-bold bg-gradient-to-r from-orange-600 to-red-600 bg-clip-text text-transparent">
                Hausto
              </h1>
            </div>
          </div>
          
          <div className="flex items-center justify-center flex-1 px-2 md:px-4">
            <div className="flex items-center space-x-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.location.href = '/ai-chat'}
                className="text-xs px-2 py-1.5 h-8"
              >
                <Sparkles className="w-3.5 h-3.5 mr-1" />
                <span className="hidden xs:inline text-xs">AI Chat</span>
              </Button>
              
              <Button
                variant={currentView === 'swipe' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setCurrentView('swipe')}
                className={`text-xs px-2 py-1.5 h-8 ${currentView === 'swipe' ? 'bg-primary text-primary-foreground' : ''}`}
              >
                <Heart className="w-3.5 h-3.5 mr-1" />
                <span className="hidden xs:inline text-xs">Discover</span>
              </Button>
              
              <Button
                variant={currentView === 'matches' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setCurrentView('matches')}
                className={`relative text-xs px-2 py-1.5 h-8 ${currentView === 'matches' ? 'bg-primary text-primary-foreground' : ''}`}
              >
                <MessageSquare className="w-3.5 h-3.5 mr-1" />
                <span className="hidden xs:inline text-xs">Matches</span>
                {matchCount > 0 && (
                  <Badge className="ml-1 bg-primary text-primary-foreground text-xs h-4 min-w-4 flex items-center justify-center rounded-full">
                    {matchCount}
                  </Badge>
                )}
              </Button>
            </div>
          </div>

          <div className="flex items-center min-w-0">
            <UserMenu 
              userType={userType}
              onSwitchUserType={onSwitchUserType}
              onRestartOnboarding={onRestartOnboarding}
              onViewProfile={() => setCurrentView('profile')}
              isAdmin={isAdmin}
            />
          </div>
        </div>
      </div>
    </nav>
  );
};
