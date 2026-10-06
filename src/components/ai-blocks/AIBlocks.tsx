import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Building2, MapPin, Route, ArrowRight, Search, MessageCircle } from 'lucide-react';
import { SearchForMePrompt } from '@/components/SearchForMePrompt';

// Parse "[Search] ..." or "[Ask] ..." prefix from an AI follow-up suggestion.
// Defaults to "ask" when no tag is present so the chip still works.
function parseFollowup(raw: string): { intent: 'search' | 'ask'; label: string; clean: string } {
  const trimmed = (raw || '').trim();
  const m = trimmed.match(/^\[(search|ask)\]\s*(.+)$/i);
  if (m) {
    const intent = m[1].toLowerCase() === 'search' ? 'search' : 'ask';
    const clean = m[2].trim();
    return { intent, label: clean, clean };
  }
  return { intent: 'ask', label: trimmed, clean: trimmed };
}

export type AIBlock =
  | { type: 'text'; body: string }
  | {
      // Compact teaser card — facts live in the text answer and on the
      // /complexes/<slug> profile page this card links to.
      type: 'complex';
      name: string;
      slug?: string;
      heroImage?: string;
      tagline?: string;
      city?: string;
      district?: string;
      tags?: string[];
      rentFrom?: number;
    }
  | {
      type: 'district';
      city?: string;
      district: string;
      vibe: string;
      bestFor?: string[];
      tradeoffs?: string[];
      notableComplexes?: string[];
    }
  | {
      type: 'distance';
      from: string;
      to: string;
      km?: number;
      driveMinutes?: number;
      bikeMinutes?: number;
      notes?: string;
    }
  | { type: 'followups'; suggestions: string[] }
  | {
      // Added by chat-ai, never the model: a search that found little, and
      // what it asked for, so Search for me opens filled in.
      type: 'search_for_me';
      found?: number;
      districts?: string[];
      bedrooms?: number | null;
      budgetMaxVnd?: number | null;
    };

interface AIBlocksProps {
  blocks?: AIBlock[] | null;
  onFollowup?: (suggestion: string) => void;
}

export const AIBlocks = ({ blocks, onFollowup }: AIBlocksProps) => {
  if (!blocks || blocks.length === 0) return null;
  return (
    <div className="w-full space-y-5">
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'text':
            return (
              <div
                key={i}
                className="bg-secondary text-secondary-foreground p-3 rounded-lg max-w-[85%] sm:max-w-[70%] md:max-w-[60%] w-fit"
              >
                <p className="text-sm whitespace-pre-wrap text-left">{block.body}</p>
              </div>
            );

          case 'complex': {
            const inner = (
              <div className="flex items-stretch">
                {block.heroImage && (
                  <img loading="lazy"
                    src={block.heroImage}
                    alt={block.name}
                    className="w-28 sm:w-36 object-cover flex-shrink-0 group-hover:opacity-95 transition-opacity"
                  />
                )}
                <div className="p-3 flex-1 min-w-0 text-left space-y-1">
                  <div className="flex items-start gap-1.5">
                    <Building2 className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                    <h4 className="text-sm font-serif text-foreground leading-tight">{block.name}</h4>
                  </div>
                  {block.tagline && (
                    <p className="text-xs text-foreground/70 italic line-clamp-2">{block.tagline}</p>
                  )}
                  {(block.district || block.city) && (
                    <p className="text-xs text-muted-foreground capitalize">
                      {[block.district, block.city].filter(Boolean).map(s => String(s).replace(/_/g, ' ')).join(' · ')}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    {typeof block.rentFrom === 'number' && block.rentFrom > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        From ${block.rentFrom.toLocaleString()}/mo
                      </Badge>
                    )}
                    {block.tags?.map((t, j) => (
                      <Badge key={j} variant="outline" className="text-xs">
                        {t}
                      </Badge>
                    ))}
                  </div>
                  {block.slug && (
                    <span className="text-xs text-primary font-medium inline-flex items-center gap-1 pt-0.5 group-hover:underline">
                      View full profile
                      <ArrowRight className="h-3 w-3" />
                    </span>
                  )}
                </div>
              </div>
            );
            return (
              <Card key={i} className="border-border overflow-hidden max-w-md">
                {block.slug ? (
                  <Link
                    to={`/complexes/${block.slug}`}
                    className="group block"
                    aria-label={`View ${block.name} profile`}
                  >
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </Card>
            );
          }

          case 'district':
            return (
              <Card key={i} className="border-border">
                <CardContent className="p-4 space-y-3 text-left">
                  <div className="flex items-start gap-2">
                    <MapPin className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-base font-serif text-foreground">{block.district}</h4>
                      {block.city && (
                        <p className="text-xs text-muted-foreground capitalize">{block.city}</p>
                      )}
                    </div>
                  </div>

                  {block.vibe && <p className="text-sm text-foreground">{block.vibe}</p>}

                  {(block.bestFor?.length || block.tradeoffs?.length) && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      {block.bestFor && block.bestFor.length > 0 && (
                        <div>
                          <p className="font-semibold text-muted-foreground mb-1">Best for</p>
                          <ul className="space-y-0.5">
                            {block.bestFor.map((b, j) => (
                              <li key={j} className="text-foreground">• {b}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {block.tradeoffs && block.tradeoffs.length > 0 && (
                        <div>
                          <p className="font-semibold text-muted-foreground mb-1">Trade-offs</p>
                          <ul className="space-y-0.5">
                            {block.tradeoffs.map((t, j) => (
                              <li key={j} className="text-foreground">• {t}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {block.notableComplexes && block.notableComplexes.length > 0 && (
                    <div className="border-t border-border pt-2">
                      <p className="text-xs font-semibold text-muted-foreground mb-1.5">
                        Notable complexes
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {block.notableComplexes.map((c, j) => (
                          <Badge
                            key={j}
                            variant="secondary"
                            className="text-xs cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
                            onClick={() => onFollowup?.(`Tell me about ${c}`)}
                          >
                            {c}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );

          case 'distance':
            return (
              <Card key={i} className="border-border">
                <CardContent className="p-4 text-left">
                  <div className="flex items-center gap-2 mb-2">
                    <Route className="h-5 w-5 text-primary flex-shrink-0" />
                    <div className="text-sm font-medium text-foreground flex items-center gap-1.5">
                      <span>{block.from}</span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      <span>{block.to}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-foreground">
                    {typeof block.km === 'number' && (
                      <span>
                        <span className="text-muted-foreground">Distance: </span>
                        {block.km} km
                      </span>
                    )}
                    {typeof block.driveMinutes === 'number' && (
                      <span>
                        <span className="text-muted-foreground">Drive: </span>~{block.driveMinutes} min
                      </span>
                    )}
                    {typeof block.bikeMinutes === 'number' && (
                      <span>
                        <span className="text-muted-foreground">Motorbike: </span>~{block.bikeMinutes} min
                      </span>
                    )}
                  </div>
                  {block.notes && (
                    <p className="text-xs text-muted-foreground italic mt-2">{block.notes}</p>
                  )}
                </CardContent>
              </Card>
            );

          case 'followups':
            if (!block.suggestions?.length) return null;
            return (
              <div key={i} className="flex flex-wrap gap-2">
                {block.suggestions.map((s, j) => {
                  const { intent, label, clean } = parseFollowup(s);
                  const isSearch = intent === 'search';
                  const Icon = isSearch ? Search : MessageCircle;
                  return (
                    <Button
                      key={j}
                      variant="ghost"
                      size="sm"
                      onClick={() => onFollowup?.(clean)}
                      className={
                        `text-xs h-auto py-2 px-3.5 rounded-full inline-flex items-center gap-1.5 text-left whitespace-normal ` +
                        (isSearch
                          ? 'bg-primary/10 text-primary hover:bg-primary/20'
                          : 'bg-secondary/50 text-foreground hover:bg-secondary')
                      }
                    >
                      <Icon className="h-3 w-3 shrink-0 mt-0.5" />
                      <span className="min-w-0">{label}</span>
                    </Button>
                  );
                })}
              </div>
            );

          case 'search_for_me':
            return (
              <SearchForMePrompt
                key={i}
                className="max-w-[640px]"
                found={block.found ?? 0}
                prefill={{ districts: block.districts, bedrooms: block.bedrooms, budgetMaxVnd: block.budgetMaxVnd }}
              />
            );

          default:
            return null;
        }
      })}
    </div>
  );
};
