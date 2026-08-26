import { Helmet } from 'react-helmet-async';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { HaustoLogo } from '@/components/HaustoLogo';
import { Sparkles } from 'lucide-react';
import { BrowseTable } from '@/components/BrowseTable';
import { CurrencyProvider } from '@/contexts/CurrencyContext';

// Public standalone browse page (SEO + AI-agent crawlable). Signed-in renters
// also get this table as the Browse view inside /discover.
const Browse = () => {
  const navigate = useNavigate();

  return (
    <CurrencyProvider>
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-red-50">
      <Helmet>
        <title>Browse rentals - Hausto</title>
        <meta name="description" content="Compare verified rental apartments in Ho Chi Minh City, Hanoi, and Da Nang. Sortable table with prices, sizes, and freshness - duplicates merged." />
        <link rel="canonical" href="https://hausto.lovable.app/browse" />
      </Helmet>

      {/* Header mirrors the landing page nav for a consistent shell */}
      <header className="container mx-auto px-4 py-4 md:py-6 max-w-6xl">
        <nav className="flex items-center justify-between">
          <Link to="/" className="flex items-center">
            <HaustoLogo />
          </Link>
          <Button variant="outline" size="sm" className="border-primary text-primary hover:bg-primary hover:text-primary-foreground" onClick={() => navigate('/hub')}>
            <Sparkles className="w-4 h-4 mr-2" />
            Vibe match
          </Button>
        </nav>
      </header>

      <main className="container mx-auto px-4 pb-12 pt-2 max-w-6xl">
        <div className="text-center mb-8">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-2">Live Inventory</p>
          <h1 className="font-serif text-3xl md:text-4xl tracking-tight">Browse rentals</h1>
          <p className="text-sm md:text-base text-muted-foreground mt-2 max-w-xl mx-auto">
            Auto-curated from Vietnam's top rental platforms, verified fresh, no duplicates, dead listings removed.
          </p>
        </div>
        <BrowseTable />
      </main>
    </div>
    </CurrencyProvider>
  );
};

export default Browse;
