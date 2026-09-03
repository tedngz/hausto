import type { ReactNode } from 'react';
import { Check, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// The single vibe-match popover used everywhere a vibe badge appears, so the
// breakdown reads identically on the swipe/editorial cards, Hausto Agent and the
// listing page. Callers supply their own badge as the trigger.

export interface VibeScoreDetails {
  overall: number; // 0-100
  breakdown?: {
    style?: number;
    color?: number;
    activities?: number;
    price?: number;
    location?: number;
    size?: number;
  };
}

export interface VibeAttribute {
  label: string;
  matched: boolean;
}

export interface VibeMatchAttributes {
  style: VibeAttribute[];
  /** Quiz lifestyle activities, matched via the property's soft features. */
  lifestyle?: VibeAttribute[];
  features: VibeAttribute[];
}

// Dimensions shown as attribute chips: aesthetic style + concrete features
// (must-haves and lifestyle-derived), each flagged matched/unmatched.
const ATTRIBUTE_GROUPS: Array<{ key: 'style' | 'lifestyle' | 'features'; label: string }> = [
  { key: 'style', label: 'Style' },
  { key: 'lifestyle', label: 'Lifestyle' },
  { key: 'features', label: 'Features' },
];

// Practical dimensions shown as a compact fit indicator, not a competing bar.
const fitFromScore = (score?: number): { label: string; ok: boolean } | null => {
  if (typeof score !== 'number') return null;
  if (score >= 100) return { label: 'Perfect', ok: true };
  if (score >= 60) return { label: 'Close', ok: true };
  return { label: 'Off', ok: false };
};

interface VibeMatchPopoverProps {
  /** Omitted for signed-out visitors — the popover then just describes the vibe */
  vibeScore?: VibeScoreDetails;
  vibeMatch?: VibeMatchAttributes;
  /** Prose shown when no attributes exist (e.g. the AI match reason) */
  vibeDetailsText?: string;
  /** What the score measures: fit to the current AI search or to saved preferences */
  scoreContext?: 'search' | 'preferences';
  /** Shown under the header when there is no score (e.g. a sign-in nudge) */
  note?: string;
  align?: 'start' | 'center' | 'end';
  /** The vibe badge that opens this popover */
  children: ReactNode;
}

export const VibeMatchPopover = ({
  vibeScore,
  vibeMatch,
  vibeDetailsText,
  scoreContext = 'preferences',
  note,
  align = 'start',
  children,
}: VibeMatchPopoverProps) => {
  const hasAttributes =
    !!vibeMatch && vibeMatch.style.length + (vibeMatch.lifestyle?.length ?? 0) + vibeMatch.features.length > 0;

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-72 p-4" align={align} onClick={e => e.stopPropagation()}>
        <div className={`flex items-center justify-between ${vibeScore ? 'mb-1' : 'mb-3'}`}>
          <span className="text-sm font-semibold text-foreground">
            {!vibeScore ? 'Vibe' : scoreContext === 'search' ? 'Search match' : 'Vibe match'}
          </span>
          {vibeScore && (
            <span className="text-xs font-mono text-muted-foreground">{Math.round(Number(vibeScore.overall))}%</span>
          )}
        </div>
        {vibeScore && (
          <p className="text-xs text-muted-foreground mb-3">
            {scoreContext === 'search'
              ? 'How well this home fits what you asked for.'
              : 'How this home aligns with your preferences.'}
          </p>
        )}

        {hasAttributes ? (
          <div className="space-y-2.5">
            {ATTRIBUTE_GROUPS.map(({ key, label }) => {
              const items = vibeMatch![key];
              if (!items || items.length === 0) return null;
              return (
                <div key={key}>
                  <p className="text-[11px] font-medium text-muted-foreground mb-1">{label}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {items.map((a, j) => (
                      <span
                        key={j}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] capitalize border ${
                          a.matched
                            ? 'bg-primary/10 border-primary/40 text-primary font-medium'
                            : 'bg-transparent border-border text-muted-foreground'
                        }`}
                      >
                        {a.matched && <Check className="w-2.5 h-2.5" />}
                        {a.label}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}

            {/* Practical fit: budget + size + location as compact indicators */}
            {vibeScore &&
              (() => {
                const budget = fitFromScore(vibeScore.breakdown?.price);
                const location = fitFromScore(vibeScore.breakdown?.location);
                const sizeFit = fitFromScore(vibeScore.breakdown?.size);
                if (!budget && !location && !sizeFit) return null;
                return (
                  <div className="flex items-center gap-4 pt-1 mt-1 border-t border-border">
                    {budget && (
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        {budget.ok ? <Check className="w-3 h-3 text-emerald-500" /> : <X className="w-3 h-3 text-muted-foreground" />}
                        Budget · {budget.label}
                      </span>
                    )}
                    {sizeFit && (
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        {sizeFit.ok ? <Check className="w-3 h-3 text-emerald-500" /> : <X className="w-3 h-3 text-muted-foreground" />}
                        Size · {sizeFit.label}
                      </span>
                    )}
                    {location && (
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        {location.ok ? <Check className="w-3 h-3 text-emerald-500" /> : <X className="w-3 h-3 text-muted-foreground" />}
                        Location · {location.label}
                      </span>
                    )}
                  </div>
                );
              })()}
          </div>
        ) : vibeDetailsText ? (
          <p className="text-xs text-foreground/90 leading-relaxed">{vibeDetailsText}</p>
        ) : (
          <p className="text-xs text-muted-foreground">A quick read on how this home matches your style and lifestyle.</p>
        )}

        {note && <p className="text-[11px] text-muted-foreground border-t border-border pt-2.5 mt-2.5">{note}</p>}
      </PopoverContent>
    </Popover>
  );
};
