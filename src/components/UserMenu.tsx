
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { MoreVertical, RotateCcw, LogOut, User, Building2, Home, Globe } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { CurrencyDropdown } from '@/components/CurrencyDropdown';
import { LanguageSelector } from '@/components/LanguageSelector';
import { useLanguage } from '@/contexts/LanguageContext';

interface UserMenuProps {
  userType: 'renter' | 'realtor';
  onSwitchUserType: () => void;
  onRestartOnboarding?: () => void;
  onViewProfile?: () => void;
}

export const UserMenu = ({ userType, onSwitchUserType, onRestartOnboarding, onViewProfile }: UserMenuProps) => {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const { t } = useLanguage();

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
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
        <div className="px-2 py-1">
          <LanguageSelector />
        </div>
        <DropdownMenuSeparator />
        {onViewProfile && (
          <>
            <DropdownMenuItem onClick={onViewProfile}>
              <User className="w-4 h-4 mr-2" />
              {t('nav.profile')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {onRestartOnboarding && (
          <>
            <DropdownMenuItem onClick={onRestartOnboarding}>
              <RotateCcw className="w-4 h-4 mr-2" />
              {t('nav.restartQuiz')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onClick={onSwitchUserType}>
          {userType === 'renter' ? (
            <>
              <Building2 className="w-4 h-4 mr-2" />
              {t('nav.switchToRealtor')}
            </>
          ) : (
            <>
              <Home className="w-4 h-4 mr-2" />
              {t('nav.switchToRenter')}
            </>
          )}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut}>
          <LogOut className="w-4 h-4 mr-2" />
          {t('nav.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
