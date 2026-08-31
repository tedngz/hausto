import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Loader2, Lock, MapPin, Sparkles, Train } from 'lucide-react';
import { usePass } from '@/hooks/usePass';
import { useDeepAnalysis, type PropertyType } from '@/hooks/useDeepAnalysis';

interface DeepVibeAnalysisProps {
  propertyId: string;
  propertyType?: PropertyType;
  /** Opens the plan modal when the renter has no pass. */
  onRequestPass?: () => void;
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
 * Three states, and the locked one is the pitch - it names what the read covers
 * rather than hiding behind "upgrade to see more", because a renter can't judge
 * whether it's worth $25 from a blurred box.
 */
export const DeepVibeAnalysis = ({
  propertyId,
  propertyType = 'internal',
  onRequestPass,
}: DeepVibeAnalysisProps) => {
  const { pass } = usePass();
  const { analysis, generatedAt, isLoading, isGenerating, generate } = useDeepAnalysis(
    propertyId,
    propertyType,
  );

  if (isLoading) return null;

  // Already generated - readable whether or not the pass is still live.
  if (analysis) {
    return (
      <Card className="border-primary/30 bg-primary/[0.03]">
        <CardContent className="pt-4 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="font-medium text-sm">Deep read</span>
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
        </CardContent>
      </Card>
    );
  }

  // Pass holder, nothing generated yet.
  if (pass?.active) {
    return (
      <Card className="border-dashed">
        <CardContent className="pt-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 font-medium text-sm">
              <Sparkles className="h-4 w-4 text-primary" />
              Deep read
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              The layout and light, who it suits, the honest downsides, and how the area fits you.
            </p>
          </div>
          <Button onClick={generate} disabled={isGenerating} className="shrink-0">
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Reading the photos...
              </>
            ) : (
              'Get the deep read'
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Locked. Name what's behind it - nobody buys a blurred box.
  return (
    <Card className="border-dashed">
      <CardContent className="pt-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 font-medium text-sm">
            <Lock className="h-3.5 w-3.5 text-muted-foreground" />
            Deep read
            <Badge variant="secondary" className="text-[10px]">Pass</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            What the photos actually show - layout, light, finish quality - plus who the place
            suits, the downsides the listing won't mention, and how the area and commute fit
            what you're looking for.
          </p>
        </div>
        <Button variant="outline" onClick={onRequestPass} className="shrink-0">
          Unlock with a Pass
        </Button>
      </CardContent>
    </Card>
  );
};
