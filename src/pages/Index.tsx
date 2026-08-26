import { Helmet } from 'react-helmet-async';
import { LandingPage } from '@/components/LandingPage';
import { CurrencyProvider } from '@/contexts/CurrencyContext';

const Index = () => {
  return (
    <CurrencyProvider>
      <Helmet>
        <title>Hausto - Rental vibe check</title>
        <meta name="description" content="Find rental apartments in Ho Chi Minh City, Hanoi, and Da Nang with AI vibe matching. Ask the AI for what you want and get homes that match your style." />
        <link rel="canonical" href="https://hausto.lovable.app/" />
        <meta property="og:title" content="Hausto - AI-Powered Property Discovery in Vietnam" />
        <meta property="og:description" content="Find rental apartments in Vietnam with AI vibe matching. Ask the AI for what you want and get properties that match your style." />
        <meta property="og:url" content="https://hausto.lovable.app/" />
      </Helmet>
      <LandingPage />
    </CurrencyProvider>
  );
};

export default Index;
