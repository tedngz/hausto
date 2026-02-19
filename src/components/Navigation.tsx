
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Heart, MessageSquare, User, Users, Sparkles, Search } from 'lucide-react';
import { CurrencyDropdown } from '@/components/CurrencyDropdown';
import { UserMenu } from '@/components/UserMenu';
import { useNavigate } from 'react-router-dom';

interface NavigationProps {
  currentView: 'swipe' | 'matches' | 'profile' | 'ai-chat';
  setCurrentView: (view: 'swipe' | 'matches' | 'profile' | 'ai-chat') => void;
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
              className="flex items-center justify-center space-x-1.5 md:space-x-2 cursor-pointer"
              onClick={() => navigate('/')}
            >
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
          
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex items-center space-x-1">
              <Button
                variant={currentView === 'ai-chat' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setCurrentView('ai-chat')}
                className={`px-3 py-2 h-10 w-10 ${currentView === 'ai-chat' ? 'bg-primary text-primary-foreground' : ''}`}
              >
                <Sparkles className="w-5 h-5" />
              </Button>
              
              <Button
                variant={currentView === 'swipe' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setCurrentView('swipe')}
                className={`px-3 py-2 h-10 w-10 ${currentView === 'swipe' ? 'bg-primary text-primary-foreground' : ''}`}
              >
                <Search className="w-5 h-5" />
              </Button>
              
              <Button
                variant={currentView === 'matches' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setCurrentView('matches')}
                className={`relative px-3 py-2 h-10 w-10 ${currentView === 'matches' ? 'bg-primary text-primary-foreground' : ''}`}
              >
                <Heart className="w-5 h-5" />
                {matchCount > 0 && (
                  <Badge className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-xs h-4 min-w-4 flex items-center justify-center rounded-full">
                    {matchCount}
                  </Badge>
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
