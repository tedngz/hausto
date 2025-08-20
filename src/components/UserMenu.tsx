
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { MoreVertical, RotateCcw, LogOut, User } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { CurrencyDropdown } from '@/components/CurrencyDropdown';

interface UserMenuProps {
  userType: 'renter' | 'realtor';
  onSwitchUserType: () => void;
  onRestartOnboarding?: () => void;
  onViewProfile?: () => void;
}

export const UserMenu = ({ userType, onSwitchUserType, onRestartOnboarding, onViewProfile }: UserMenuProps) => {
  const { signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="p-2">
          <MoreVertical className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
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
        <DropdownMenuItem onClick={onSwitchUserType}>
          <User className="w-4 h-4 mr-2" />
          Switch to {userType === 'renter' ? 'Realtor' : 'Renter'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut}>
          <LogOut className="w-4 h-4 mr-2" />
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
