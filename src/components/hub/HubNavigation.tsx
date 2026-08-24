
import { useNavigate } from 'react-router-dom';
import { UserMenu } from '@/components/UserMenu';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useUserRoles } from '@/hooks/useUserRoles';

interface HubNavigationProps {
  onViewProfile: () => void;
  onRestartOnboarding: () => void;
}

/**
 * The hub's top bar.
 *
 * There is almost nothing left to navigate to: browse, AI chat, matches,
 * profile and onboarding all live on this page now, and the swipe deck is
 * retired. What remains is the building directory, and - for accounts that have
 * realtor access - the way back to the realtor dashboard.
 */
export const HubNavigation = ({ onViewProfile, onRestartOnboarding }: HubNavigationProps) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isRealtor } = useUserRoles();

  return (
    <nav className="relative flex h-16 shrink-0 items-center justify-between border-b border-gray-200 bg-white/80 px-4 backdrop-blur-md md:px-6">
      <button
        className="z-10 flex items-center gap-2"
        onClick={() => navigate('/')}
        aria-label="Hausto home"
      >
        <img
          src="/lovable-uploads/15e7e5a0-a35d-46c1-b0ba-9e273a963e39.png"
          alt=""
          className="h-6 w-6"
        />
        <span className="hidden bg-gradient-to-r from-orange-600 to-red-600 bg-clip-text text-xl font-bold text-transparent sm:block">
          Hausto
        </span>
      </button>

      {/* No centred nav icons: everything they pointed at - search, browse,
          matches, complexes, the map - is a tab on this page now. */}

      <div className="z-10 flex items-center">
        {user ? (
          <UserMenu
            userType="renter"
            // Only offered to accounts that actually have realtor access - for
            // everyone else /discover is not a place they can go any more.
            onSwitchUserType={() => {
              if (isRealtor) navigate('/discover');
            }}
            onViewProfile={onViewProfile}
            onRestartOnboarding={onRestartOnboarding}
          />
        ) : (
          <Button
            size="sm"
            className="h-9"
            onClick={() => navigate('/auth', { state: { returnTo: '/hub' } })}
          >
            Sign in
          </Button>
        )}
      </div>
    </nav>
  );
};
