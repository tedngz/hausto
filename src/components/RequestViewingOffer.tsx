import { CalendarCheck, Languages, ShieldCheck } from 'lucide-react';
import { PASS_DAYS, PASS_PRICE_USD, usePass } from '@/hooks/usePass';

// Why ask Hausto rather than ring the number on the original ad: the small
// print under "Request viewing", wherever a listing offers it - the preview
// that opens over browse and the AI's results, and the listing page. One
// component, so the two say the same thing.
//
// What it costs first, then what we do, then (where a caller has one) the way
// to our own page: the offer has to be legible before the exit is.

// Icons in the card's own accent, as its amenities are - a green tick here
// read as a second design system bolted under the button.
const OFFER_POINTS = [
  { icon: CalendarCheck, text: 'We arrange it with the agent' },
  { icon: Languages, text: 'English-speaking coordination' },
  { icon: ShieldCheck, text: 'Your contact details stay private' },
];

export function RequestViewingOffer({ source }: {
  /** Our own page for the listing, as "View on ..."; outside links are dropped. */
  source?: { name: string; href?: string | null };
}) {
  const { pass } = usePass();
  return (
    <div className="flex flex-col items-center gap-2.5 text-center">
      <p className="text-[12.5px] text-muted-foreground [text-wrap:balance]">
        {/* Arranging viewings is the Pass's, with one free place per
            WhatsApp number (requestGate, SPEC §9). */}
        {pass?.active ? (
          <>
            <span className="font-medium text-foreground">Covered by your Pass</span>
            {' - every viewing we arrange'}
          </>
        ) : (
          <>
            <span className="font-medium text-foreground">Your first viewing is on us</span>
            {` - then the Pass ($${PASS_PRICE_USD} for ${PASS_DAYS} days)`}
          </>
        )}
      </p>
      <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-[12px] text-muted-foreground">
        {OFFER_POINTS.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-1.5">
            <Icon className="w-3.5 h-3.5 flex-shrink-0 text-primary" aria-hidden="true" />
            <span>{text}</span>
          </li>
        ))}
      </ul>
      {/* Our own page only. A crawled listing's original ad carries the
          agent's number, which reaches a renter only through the request
          modal's choice, signed in and logged (CLAUDE.md invariant 4) - so an
          outside link is dropped here even if a caller passes one. */}
      {source?.href?.startsWith('/') && (
        <a
          href={source.href}
          className="text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          View on {source.name}
        </a>
      )}
    </div>
  );
}
