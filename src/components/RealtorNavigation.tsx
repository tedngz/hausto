import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Building, MessageSquare, User, Plus, ArrowLeftRight, LogOut, MoreVertical } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';

interface RealtorNavigationProps {
  currentView: 'dashboard' | 'profile';
  setCurrentView: (view: 'dashboard' | 'profile') => void;
  matchCount: number;
  onSwitchUserType: () => void;
  onOpenAIChat: () => void;
  onAddProperty?: () => void;
}

export const RealtorNavigation = ({ 
  currentView, 
  setCurrentView, 
  matchCount, 
  onSwitchUserType,
  onOpenAIChat,
  onAddProperty
}: RealtorNavigationProps) => {
  const { signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };
  return (
    <nav className="fixed top-0 left-0 right-0 z-40 bg-white/80 backdrop-blur-md border-b border-gray-200">
      <div className="max-w-4xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <div className="flex items-center space-x-2">
              <img 
                src="/lovable-uploads/e6e36f1b-c1ac-4aa8-a584-dac48543e870.png" 
                alt="Hausto Logo" 
                className="w-6 h-6"
              />
              <h1 className="text-xl font-bold bg-gradient-to-r from-orange-600 to-red-600 bg-clip-text text-transparent">
                Hausto
              </h1>
            </div>
          </div>
          
          <div className="flex items-center justify-center flex-1">
            <div className="flex items-center space-x-0.5 md:space-x-1">
              <Button
                variant={currentView === 'dashboard' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setCurrentView('dashboard')}
                className={`text-xs md:text-sm px-2 md:px-3 ${currentView === 'dashboard' ? 'bg-primary text-primary-foreground' : ''}`}
              >
                <Building className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
                <span className="hidden sm:inline">Dashboard</span>
              </Button>
              
              <Button
                variant={currentView === 'profile' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setCurrentView('profile')}
                className={`text-xs md:text-sm px-2 md:px-3 ${currentView === 'profile' ? 'bg-primary text-primary-foreground' : ''}`}
              >
                <User className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
                <span className="hidden sm:inline">Profile</span>
              </Button>
            </div>
          </div>

          <div className="flex items-center">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="p-2">
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 bg-white border shadow-lg z-50">
                {onAddProperty && (
                  <>
                    <DropdownMenuItem onClick={onAddProperty}>
                      <Plus className="w-4 h-4 mr-2" />
                      Add Property
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem onClick={onSwitchUserType}>
                  <ArrowLeftRight className="w-4 h-4 mr-2" />
                  Switch to Renter
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </nav>
  );
};