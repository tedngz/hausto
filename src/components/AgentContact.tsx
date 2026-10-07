import { ExternalLink, MessageCircle, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { displayVnPhone, zaloLink } from '@/lib/agentContact';

// The agent's number from a crawled listing's original ad (SPEC §6, owner's
// decision 2026-10-07). A renter reaches it one way: "Request viewing" on a
// place whose ad lists one opens RequestViewingModal on a choice - we arrange
// it, or call the agent yourself - and the second goes through useAgentReveal,
// signed in and logged. This only shows what that returned.

/** A revealed number, with ways to use it and the ad it came from. */
export function AgentNumber({ phoneE164, sourceUrl, sourceName }: {
  phoneE164: string;
  sourceUrl: string | null;
  sourceName?: string;
}) {
  const zalo = zaloLink(phoneE164);
  return (
    <div aria-label="The agent's number">
      <a
        href={`tel:${phoneE164}`}
        className="inline-block font-serif text-2xl tracking-tight text-foreground hover:text-primary"
      >
        {displayVnPhone(phoneE164)}
      </a>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm" className="h-8 rounded-full">
          <a href={`tel:${phoneE164}`}>
            <Phone className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Call
          </a>
        </Button>
        {zalo && (
          <Button asChild variant="outline" size="sm" className="h-8 rounded-full">
            <a href={zalo} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Zalo
            </a>
          </Button>
        )}
        {sourceUrl && (
          <Button asChild variant="ghost" size="sm" className="h-8 rounded-full text-muted-foreground">
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer nofollow">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {sourceName ? `Original ad on ${sourceName}` : 'Original ad'}
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}
