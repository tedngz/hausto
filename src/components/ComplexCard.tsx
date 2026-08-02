import { Link } from 'react-router-dom';
import { MapPin, Building2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Complex, CITY_LABEL } from '@/hooks/useComplexes';

export function ComplexCard({ complex }: { complex: Complex }) {
  const fromPrice = complex.average_rent_brackets?.['1br']?.min
    ?? complex.average_rent_brackets?.['2br']?.min;

  return (
    <Link to={`/complexes/${complex.slug}`} className="group">
      <Card className="overflow-hidden border-border/60 hover:border-primary/40 transition-all duration-300 hover:shadow-xl">
        <div className="relative aspect-[4/3] overflow-hidden bg-muted">
          {complex.hero_image && (
            <img
              src={complex.hero_image}
              alt={complex.name}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background/90 to-transparent p-4">
            <div className="flex flex-wrap gap-1.5">
              {complex.tags?.slice(0, 2).map((t) => (
                <Badge key={t} variant="secondary" className="backdrop-blur-sm bg-background/70 text-xs">
                  {t}
                </Badge>
              ))}
            </div>
          </div>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <h3 className="font-serif text-xl font-medium leading-tight group-hover:text-primary transition-colors">
              {complex.name}
            </h3>
            <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{complex.district}, {CITY_LABEL[complex.city] ?? complex.city}</span>
            </div>
          </div>
          {complex.management_company && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{complex.management_company} managed</span>
            </div>
          )}
          {fromPrice && (
            <div className="pt-2 border-t border-border/60">
              <span className="text-xs text-muted-foreground">From </span>
              <span className="font-semibold text-foreground">${fromPrice.toLocaleString()}</span>
              <span className="text-xs text-muted-foreground"> / month</span>
            </div>
          )}
        </div>
      </Card>
    </Link>
  );
}
