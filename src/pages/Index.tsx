import { Helmet } from 'react-helmet-async';
import { LandingPage } from '@/components/LandingPage';
import { CurrencyProvider } from '@/contexts/CurrencyContext';

const Index = () => {
  return (
    <CurrencyProvider>
      <Helmet>
        <title>Hausto - Vibe check your next home</title>
        <meta name="description" content="Vibe checked. Search Vietnam’s best rentals in seconds. Zero runaround." />
        <link rel="canonical" href="https://hausto.lovable.app/" />
        <meta property="og:title" content="Hausto - Find your apartment in Vietnam" />
        <meta property="og:description" content="Search verified apartments in Ho Chi Minh City, Hanoi, and Da Nang with AI vibe matching - see real listings and photos before you visit." />
        <meta property="og:url" content="https://hausto.lovable.app/" />
      </Helmet>
      <LandingPage />
    </CurrencyProvider>
  );
};

export default Index;
