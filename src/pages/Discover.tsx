import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { RealtorDashboard } from '@/components/RealtorDashboard';
import { RealtorNavigation } from '@/components/RealtorNavigation';
import { RealtorProfile } from '@/components/RealtorProfile';
import { CurrencyProvider } from '@/contexts/CurrencyContext';
import { useAuth } from '@/hooks/useAuth';
import { PropertyUploadModal } from '@/components/PropertyUploadModal';
import { SubscriptionModal } from '@/components/SubscriptionModal';
import { Loader2 } from 'lucide-react';
import { useUserRoles } from '@/hooks/useUserRoles';
import { useMatches } from '@/hooks/useMatches';

/**
 * The realtor workspace.
 *
 * This route used to be the whole signed-in app - an internal view switcher
 * over the AI search, the browse table, the swipe deck, matches and the
 * profile. All of those are the hub now (/hub), and the swipe deck is retired,
 * so what is left here is the half that was never duplicated: the realtor
 * dashboard and realtor profile.
 *
 * Renters who still have a link to /discover are sent to the hub.
 */
const Discover = () => {
  const { user, loading } = useAuth();
  const { isRealtor, isLoading: rolesLoading } = useUserRoles();
  const { realtorMatches } = useMatches();
  const navigate = useNavigate();

  const [currentView, setCurrentView] = useState<'dashboard' | 'profile'>('dashboard');
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isSubscriptionModalOpen, setIsSubscriptionModalOpen] = useState(false);

  useEffect(() => {
    if (loading || rolesLoading) return;
    if (!user) navigate('/');
    else if (!isRealtor) navigate('/hub', { replace: true });
  }, [user, loading, rolesLoading, isRealtor, navigate]);

  useEffect(() => {
    const open = () => setIsSubscriptionModalOpen(true);
    window.addEventListener('openSubscriptionModal', open);
    return () => window.removeEventListener('openSubscriptionModal', open);
  }, []);

  if (loading || rolesLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-slate-100">
        <div className="text-center">
          <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Redirecting; render nothing rather than flashing a dashboard they cannot use.
  if (!user || !isRealtor) return null;

  return (
    <CurrencyProvider>
      <Helmet>
        <title>Realtor dashboard - Hausto</title>
        <meta name="description" content="Manage your listings, renter matches and viewing requests on Hausto." />
        <link rel="canonical" href="https://hausto.lovable.app/discover" />
      </Helmet>

      <div className="h-screen overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100">
        <h1 className="sr-only">Hausto realtor dashboard</h1>

        <RealtorNavigation
          currentView={currentView}
          setCurrentView={(view) => setCurrentView(view)}
          matchCount={realtorMatches.length}
          onSwitchUserType={() => navigate('/hub')}
          onAddProperty={() => setIsUploadModalOpen(true)}
        />

        <main className="h-full overflow-y-auto pt-14">
          {currentView === 'dashboard' && (
            <RealtorDashboard
              onSwitchUserType={() => navigate('/hub')}
              onViewProfile={() => setCurrentView('profile')}
              onOpenUploadModal={() => setIsUploadModalOpen(true)}
            />
          )}
          {currentView === 'profile' && <RealtorProfile />}
        </main>

        <PropertyUploadModal isOpen={isUploadModalOpen} onClose={() => setIsUploadModalOpen(false)} />
        <SubscriptionModal isOpen={isSubscriptionModalOpen} onClose={() => setIsSubscriptionModalOpen(false)} />
      </div>
    </CurrencyProvider>
  );
};

export default Discover;
