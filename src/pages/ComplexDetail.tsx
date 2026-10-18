import { Link, useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Loader2 } from 'lucide-react';
import { useComplex, CITY_LABEL } from '@/hooks/useComplexes';
import { Button } from '@/components/ui/button';
import { ComplexProfile } from '@/components/ComplexProfile';
import { CurrencyProvider } from '@/contexts/CurrencyContext';

// The public, crawlable building profile. The hub shows the SAME profile in a
// panel; this page is the slug route, the metadata and the loading states
// around it.
export default function ComplexDetail() {
  const { slug } = useParams<{ slug: string }>();
  const { data: complex, isLoading } = useComplex(slug);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  if (!complex) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <h1 className="font-serif text-3xl">Complex not found</h1>
        <Button asChild><Link to="/hub">Back to the hub</Link></Button>
      </div>
    );
  }

  return (
    <CurrencyProvider>
      <Helmet>
        <title>{complex.name} — {complex.district}, {CITY_LABEL[complex.city]} | Hausto</title>
        <meta name="description" content={complex.tagline ?? `Vetted profile of ${complex.name} in ${complex.district}. Realistic rent ranges, amenities, pet policy, and concierge availability.`} />
        <link rel="canonical" href={`https://hausto.lovable.app/complexes/${complex.slug}`} />
        <meta property="og:title" content={`${complex.name} — Hausto`} />
        <meta property="og:description" content={complex.tagline || `${complex.name} in ${complex.district}, ${CITY_LABEL[complex.city]}: realistic rent ranges, amenities, pet policy and viewing help from Hausto.`} />
        {complex.hero_image && <meta property="og:image" content={complex.hero_image} />}
        <meta property="og:url" content={`https://hausto.lovable.app/complexes/${complex.slug}`} />
      </Helmet>

      <ComplexProfile complex={complex} />
    </CurrencyProvider>
  );
}
