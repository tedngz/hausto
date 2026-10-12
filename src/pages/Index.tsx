import { Helmet } from 'react-helmet-async';
import { LandingPage } from '@/components/LandingPage';
import { CurrencyProvider } from '@/contexts/CurrencyContext';

const Index = () => {
  return (
    <CurrencyProvider>
      <Helmet>
        <title>Hausto - Vibe check your next home</title>
        <meta name="description" content="Vietnam rentals, vibe checked. Search Vietnam’s best rentals in seconds. Zero runaround." />
        <link rel="canonical" href="https://hausto.lovable.app/" />
        <meta property="og:title" content="Hausto - Vibe check your next home" />
        <meta property="og:description" content="Vietnam rentals, vibe checked. Search Vietnam’s best rentals in seconds. Zero runaround." />
        <meta property="og:url" content="https://hausto.lovable.app/" />
      </Helmet>
      <LandingPage />
    </CurrencyProvider>
  );
};

export default Index;
