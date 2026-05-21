import { useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useComplexes } from '@/hooks/useComplexes';
import { ComplexCard } from '@/components/ComplexCard';
import { ComplexFilters } from '@/components/ComplexFilters';
import { Button } from '@/components/ui/button';

export default function Complexes() {
  const { data: complexes, isLoading } = useComplexes();
  const [city, setCity] = useState<string | null>(null);
  const [district, setDistrict] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);

  const districts = useMemo(() => {
    const set = new Set<string>();
    (complexes ?? []).filter((c) => !city || c.city === city).forEach((c) => set.add(c.district));
    return Array.from(set).sort();
  }, [complexes, city]);

  const tags = useMemo(() => {
    const set = new Set<string>();
    (complexes ?? []).forEach((c) => c.tags?.forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [complexes]);

  const filtered = useMemo(() => {
    return (complexes ?? []).filter((c) => {
      if (city && c.city !== city) return false;
      if (district && c.district !== district) return false;
      if (tag && !(c.tags ?? []).includes(tag)) return false;
      return true;
    });
  }, [complexes, city, district, tag]);

  return (
    <>
      <Helmet>
        <title>Vetted Luxury Complexes in Vietnam — Hausto</title>
        <meta name="description" content="Browse 100% vetted luxury rental complexes in Ho Chi Minh City and Hanoi. Permanent building profiles, realistic rent ranges, and concierge-matched availability for expats." />
        <link rel="canonical" href="https://hausto.lovable.app/complexes" />
        <meta property="og:title" content="Vetted Luxury Complexes in Vietnam" />
        <meta property="og:description" content="Permanent building profiles, realistic rent ranges, and concierge-matched availability for expats." />
        <meta property="og:url" content="https://hausto.lovable.app/complexes" />
      </Helmet>

      <main className="min-h-screen bg-gradient-to-b from-background via-background to-muted/20">
        {/* Hero */}
        <section className="border-b border-border/60">
          <div className="container mx-auto px-6 py-16 md:py-24 max-w-5xl">
            <div className="max-w-3xl">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-4">
                Complex Explorer · For pre-arrival expats
              </p>
              <h1 className="font-serif text-4xl md:text-6xl leading-[1.05] tracking-tight">
                Find your home in Vietnam <em className="text-primary not-italic">before</em> you land.
              </h1>
              <p className="mt-6 text-lg text-muted-foreground max-w-2xl">
                100% vetted luxury complexes. Zero ghost listings. Permanent building profiles with realistic rent ranges,
                pet policies, insider truths, and concierge-matched availability for your move-in date.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <a href="#directory">Explore complexes</a>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link to="/">Back to home</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Directory */}
        <section id="directory" className="container mx-auto px-6 py-12 md:py-16 max-w-7xl">
          <div className="mb-8 space-y-6">
            <ComplexFilters
              city={city} setCity={setCity}
              district={district} setDistrict={setDistrict}
              tag={tag} setTag={setTag}
              districts={districts}
              tags={tags}
            />
          </div>

          {isLoading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">
              No complexes match these filters yet. Try widening your search.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {filtered.map((c) => <ComplexCard key={c.id} complex={c} />)}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
