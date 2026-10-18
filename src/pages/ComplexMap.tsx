import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useComplexes } from '@/hooks/useComplexes';
import { ComplexMapCanvas } from '@/components/ComplexMapCanvas';

export default function ComplexMap() {
  const { data: complexes, isLoading } = useComplexes();

  return (
    <>
      <Helmet>
        <title>Map of Vetted Luxury Complexes in Vietnam — Hausto</title>
        <meta
          name="description"
          content="An editorial map of 100% vetted luxury rental complexes across Saigon and Hanoi. Browse by district, see realistic rent ranges, and tap a pin to open the building profile."
        />
        <link rel="canonical" href="https://www.hausto.com/map" />
      </Helmet>

      <main className="min-h-screen bg-[#FAF9F6]">
        <section className="container mx-auto px-6 py-12 md:py-20 max-w-6xl">
          <h1 className="font-serif text-3xl md:text-4xl tracking-tight text-center mb-8">
            Map of Vetted Luxury Complexes in Vietnam
          </h1>
          {isLoading ? (
            <div className="flex justify-center py-32">
              <Loader2 className="h-8 w-8 animate-spin text-[#0D4F4A]/40" aria-hidden />
            </div>
          ) : (
            <ComplexMapCanvas complexes={complexes ?? []} />
          )}

          <div className="mt-12 flex flex-wrap justify-center gap-3">
            <Button asChild variant="outline">
              <Link to="/hub">Browse the full directory</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link to="/">Back to home</Link>
            </Button>
          </div>
        </section>
      </main>
    </>
  );
}
