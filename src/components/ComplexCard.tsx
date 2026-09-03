import { Link } from 'react-router-dom';
import { Building2, Check, MapPin, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Complex, CITY_LABEL } from '@/hooks/useComplexes';

interface ComplexCardProps {
  complex: Complex;
  /** When set the card opens in place instead of navigating to its own page. */
  onOpen?: (complex: Complex) => void;
  /** Shows the select control; omit for a plain, non-selectable card. */
  onToggleSelect?: (complex: Complex) => void;
  selected?: boolean;
  /** Shows the sparkle that pins this complex to Hausto Agent. */
  onAskAI?: (complex: Complex) => void;
}

export function ComplexCard({ complex, onOpen, onToggleSelect, selected, onAskAI }: ComplexCardProps) {
  const fromPrice = complex.average_rent_brackets?.['1br']?.min
    ?? complex.average_rent_brackets?.['2br']?.min;

  const body = (
    <Card className={`overflow-hidden transition-all duration-300 hover:shadow-xl ${
      selected ? 'border-primary ring-1 ring-primary' : 'border-border/60 hover:border-primary/40'
    }`}>
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        {complex.hero_image && (
          <img
            src={complex.hero_image}
            alt={complex.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        )}

        {/* Select + ask, mirroring the property card's corner actions */}
        <div className="absolute right-3 top-3 flex gap-2">
          {onAskAI && (
            <button
              type="button"
              aria-label={`Ask the AI about ${complex.name}`}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/85 text-primary-foreground backdrop-blur-md transition-colors hover:bg-primary"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAskAI(complex); }}
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          {onToggleSelect && (
            <button
              type="button"
              aria-label={selected ? `Remove ${complex.name} from comparison` : `Add ${complex.name} to comparison`}
              aria-pressed={selected}
              className={`flex h-8 w-8 items-center justify-center rounded-full backdrop-blur-md transition-colors ${
                selected ? 'bg-primary text-primary-foreground' : 'bg-white/25 text-white hover:bg-white/40'
              }`}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleSelect(complex); }}
            >
              <Check className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>

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
  );

  // In the hub the profile opens beside the chat rather than replacing the
  // page; standalone it is still a link, which keeps it crawlable.
  if (onOpen) {
    return (
      <button type="button" className="group w-full text-left" onClick={() => onOpen(complex)}>
        {body}
      </button>
    );
  }

  return (
    <Link to={`/complexes/${complex.slug}`} className="group">
      {body}
    </Link>
  );
}
