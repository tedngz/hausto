import { Building2, Search, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { UserMenu } from '@/components/UserMenu';

/**
 * The hub's top bar. Same shell as the Discover nav, but the centred icons are
 * cross-page destinations rather than view switches - Browse, AI chat and
 * Matches all live inside the hub now, so what is left is the hub itself, the
 * swipe deck, and the building directory.
 */
export const HubNavigation = () => {
  const navigate = useNavigate();

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

      <div className="pointer-events-none absolute inset-x-0 flex items-center justify-center">
        <div className="pointer-events-auto flex items-center gap-2 sm:gap-3">
          <button
            aria-label="Hub"
            aria-current="page"
            className="flex h-11 w-11 items-center justify-center rounded-md bg-primary text-primary-foreground sm:h-10 sm:w-10"
          >
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            aria-label="Swipe properties"
            onClick={() => navigate('/discover?view=swipe')}
            className="flex h-11 w-11 items-center justify-center rounded-md text-foreground hover:bg-accent hover:text-accent-foreground sm:h-10 sm:w-10"
          >
            <Search className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            aria-label="Browse buildings"
            onClick={() => navigate('/complexes')}
            className="flex h-11 w-11 items-center justify-center rounded-md text-foreground hover:bg-accent hover:text-accent-foreground sm:h-10 sm:w-10"
          >
            <Building2 className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="z-10 flex items-center">
        <UserMenu
          userType="renter"
          onSwitchUserType={() => navigate('/discover')}
          onViewProfile={() => navigate('/discover?view=profile')}
        />
      </div>
    </nav>
  );
};
