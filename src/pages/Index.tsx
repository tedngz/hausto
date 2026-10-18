import { Helmet } from 'react-helmet-async';
import { LandingPage } from '@/components/LandingPage';
import { CurrencyProvider } from '@/contexts/CurrencyContext';

const Index = () => {
  return (
    <CurrencyProvider>
      <Helmet>
        <title>Hausto - Vibe check your next home</title>
        <meta name="description" content="Vibe checked. Search Vietnam’s best rentals in seconds. Zero runaround." />
        <link rel="canonical" href="https://www.hausto.com/" />
        <meta property="og:title" content="Hausto - Curated apartment rentals in Vietnam" />
        <meta property="og:description" content="Find vetted apartment rentals in Ho Chi Minh City and Hanoi. Hausto checks listings, contacts agents for you and arranges your viewings - no fake listings, no runaround." />
        <meta property="og:url" content="https://www.hausto.com/" />
      </Helmet>
      <LandingPage />
    </CurrencyProvider>
  );
};

export default Index;
