import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { MoreVertical, RotateCcw, LogOut, User, Building2, Home } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { CurrencyDropdown } from '@/components/CurrencyDropdown';
import { useUserRoles } from '@/hooks/useUserRoles';

interface UserMenuProps {
  userType: 'renter' | 'realtor';
  onSwitchUserType: () => void;
  onRestartOnboarding?: () => void;
  onViewProfile?: () => void;
}

export const UserMenu = ({ userType, onSwitchUserType, onRestartOnboarding, onViewProfile }: UserMenuProps) => {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const { isRealtor } = useUserRoles();

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Open user menu" className="p-2">
          <MoreVertical className="w-4 h-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <div className="px-2 py-1">
          <CurrencyDropdown />
        </div>
        <DropdownMenuSeparator />
        {onViewProfile && (
          <>
            <DropdownMenuItem onClick={onViewProfile}>
              <User className="w-4 h-4 mr-2" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {onRestartOnboarding && (
          <>
            <DropdownMenuItem onClick={onRestartOnboarding}>
              <RotateCcw className="w-4 h-4 mr-2" />
              Restart Quiz
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {userType === 'realtor' ? (
          <DropdownMenuItem onClick={onSwitchUserType}>
            <Home className="w-4 h-4 mr-2" />
            Switch to Renter
          </DropdownMenuItem>
        ) : isRealtor ? (
          <DropdownMenuItem onClick={onSwitchUserType}>
            <Building2 className="w-4 h-4 mr-2" />
            Switch to Realtor
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => navigate('/realtor/apply')}>
            <Building2 className="w-4 h-4 mr-2" />
            Apply as Realtor
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut}>
          <LogOut className="w-4 h-4 mr-2" />
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
