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

          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex items-center pointer-events-auto">
              <Button
                variant={currentView === 'dashboard' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setCurrentView('dashboard')}
                className={`text-xs px-2 py-1.5 h-8 ${currentView === 'dashboard' ? 'bg-primary text-primary-foreground' : ''}`}
              >
                <Building className="w-3.5 h-3.5 mr-1" />
                <span className="hidden xs:inline text-xs">Dashboard</span>
              </Button>
            </div>
          </div>

          <div className="flex items-center min-w-0 z-10">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="p-1.5 md:p-2 h-8 md:h-9">
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 bg-white border shadow-lg z-50">
                <DropdownMenuItem onClick={() => setCurrentView('profile')}>
                  <User className="w-4 h-4 mr-2" />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuSeparator />
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