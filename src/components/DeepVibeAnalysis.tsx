import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Loader2, MapPin, Sparkles, Train } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { usePass } from '@/hooks/usePass';
import { useDeepAnalysis, type PropertyType } from '@/hooks/useDeepAnalysis';

interface DeepVibeAnalysisProps {
  propertyId: string;
  propertyType?: PropertyType;
  /** Opens the plan modal when the renter has no pass. */
  onRequestPass?: () => void;
  /** Drops the card chrome so the block can sit inside another surface (the
   *  vibe-match popover) without reading as a card in a card. */
  bare?: boolean;
  /** Keep the offer stacked - heading, then a full-width button - instead of
   *  letting it become a row at the sm: breakpoint. For surfaces that are
   *  narrow while the viewport is wide, the chat rail above all: sm: measures
   *  the viewport, so a row there pushes the button out of the rail. `bare`
   *  implies it; pass it on its own to keep the card chrome and still stack. */
  stacked?: boolean;
  /** The listing's name, shown under the heading. For surfaces where the read
   *  is not adjacent to its listing - Hausto Agent, where a search returned
   *  several places - so it is never ambiguous which one was read. */
  title?: string;
  /** Show only the offer, never the scan itself. For the chip's popover, which
   *  is the wrong shape to read a scan in: it covers the card the scan is
   *  about. Pressing the button calls onScan, which hands off to the chat. */
  ctaOnly?: boolean;
  /** Where a ctaOnly block sends the renter once they have asked for the scan. */
  onScan?: () => void;
  /** Start reading on mount. Set where the renter has already asked for the
   *  scan elsewhere and this is where the answer was sent - so the ask is one
   *  press, not one here and another on arrival. */
  autoGenerate?: boolean;
}

/** Five dots rather than a number - it reads as a judgement, not a measurement. */
const Rating = ({ value }: { value?: number }) => {
  const filled = Math.max(0, Math.min(5, Math.round(value ?? 0)));
  return (
    <span className="inline-flex gap-0.5" aria-label={`${filled} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${i <= filled ? 'bg-primary' : 'bg-border'}`}
        />
      ))}
    </span>
  );
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="space-y-1">
    <h4 className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">{title}</h4>
    <div className="text-sm leading-relaxed">{children}</div>
  </div>
);

/**
 * The Pass's headline feature: an honest read of one listing for one renter.
 *
 * Two states. Before it is generated everyone signed in - pass or not - sees the
 * same offer naming what the read covers, because a renter can't judge whether
 * it's worth $25 from a blurred box; the pass is asked for at the press.
 */
export const DeepVibeAnalysis = ({
  propertyId,
  propertyType = 'internal',
  onRequestPass,
  bare = false,
  stacked = false,
  title,
  ctaOnly = false,
  onScan,
  autoGenerate = false,
}: DeepVibeAnalysisProps) => {
  const { pass } = usePass();
  const { analysis, generatedAt, isLoading, isGenerating, generate } = useDeepAnalysis(
    propertyId,
    propertyType,
  );

  // Asked for elsewhere and answered here: read it once, on arrival. The ref
  // keeps a re-render from asking twice.
  const started = useRef(false);
  useEffect(() => {
    if (!autoGenerate || isLoading || started.current) return;
    if (analysis || !pass?.active) return;
    started.current = true;
    generate();
  }, [autoGenerate, isLoading, analysis, pass?.active, generate]);

  if (isLoading) return null;

  // Already generated - readable whether or not the pass is still live.
  if (analysis && !ctaOnly) {
    const body = (
      <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                <span className="font-medium text-sm">Deep Scan</span>
              </div>
              {title && (
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{title}</p>
              )}
            </div>
            {generatedAt && (
              <span className="text-[11px] text-muted-foreground">
                {new Date(generatedAt).toLocaleDateString()}
              </span>
            )}
          </div>

          {analysis.design && <Section title="The apartment">{analysis.design}</Section>}
          {analysis.lifestyle_fit && <Section title="Who it suits">{analysis.lifestyle_fit}</Section>}

          {!!analysis.downsides?.length && (
            <Section title="Honest downsides">
              <ul className="space-y-1.5">
                {analysis.downsides.map((d, i) => (
                  <li key={i} className="flex gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-500" />
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {analysis.neighbourhood && (
              <div className="rounded-lg border border-border bg-background/60 p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-medium">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                    Neighbourhood fit
                  </span>
                  <Rating value={analysis.neighbourhood.rating} />
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {analysis.neighbourhood.note}
                </p>
              </div>
            )}
            {analysis.commute && (
              <div className="rounded-lg border border-border bg-background/60 p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-medium">
                    <Train className="h-3.5 w-3.5 text-muted-foreground" />
                    Commute
                  </span>
                  <Rating value={analysis.commute.rating} />
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {analysis.commute.note}
                </p>
              </div>
            )}
          </div>

          {analysis.worth_viewing && (
            <p className="text-sm border-t border-border pt-3 font-medium">
              {analysis.worth_viewing}
            </p>
          )}
      </div>
    );

    if (bare) return body;

    return (
      <Card className="border-primary/30 bg-primary/[0.03]">
        <CardContent className="pt-4">{body}</CardContent>
      </Card>
    );
  }

  // Nothing generated yet. Everyone signed in sees the same offer - a renter
  // cannot judge whether the read is worth paying for from a blurred box - and
  // the pass is asked for at the press, not before it.
  const locked = !pass?.active;
  // A pass holder asking from the chip is sent to the chat to read it; anywhere
  // the scan is shown in place, the press reads it here.
  const onPress = locked ? onRequestPass : ctaOnly ? onScan : generate;

  // Without a way to sell the pass there is nothing a locked renter can do
  // here, so the block stays off rather than offering a dead button.
  if (locked && !onRequestPass) return null;

  // Inside something narrow - a popover on a card, the chat rail - sm: is the
  // viewport's width, not the container's, so the row layout would push the
  // button out of the panel. Stack there.
  const isStacked = bare || stacked;

  const teaser = (
    <div className={isStacked ? 'flex flex-col gap-3' : 'flex flex-col sm:flex-row sm:items-center gap-3'}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 font-medium text-sm">
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          Deep Scan
          {locked && (
            <Badge variant="secondary" className="text-[10px]">Pass</Badge>
          )}
        </div>
        {title && (
          <p className="text-xs font-medium text-foreground/80 mt-1 truncate">{title}</p>
        )}
        <p className="text-xs text-muted-foreground mt-1 break-words">
          {ctaOnly && analysis
            ? 'Already read for you - open it in the chat, beside the listing it read.'
            : 'The layout and light, who it suits, the honest downsides, and how the area fits you.'}
        </p>
      </div>
      <Button onClick={onPress} disabled={isGenerating} className={isStacked ? 'w-full' : 'shrink-0'}>
        {isGenerating ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Reading the photos...
          </>
        ) : ctaOnly && analysis ? (
          'Open the Deep Scan'
        ) : (
          'Get the Deep Scan'
        )}
      </Button>
    </div>
  );

  if (bare) return teaser;

  return (
    <Card className="border-dashed">
      <CardContent className="pt-4">{teaser}</CardContent>
    </Card>
  );
};
