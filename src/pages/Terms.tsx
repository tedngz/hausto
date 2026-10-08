import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { ScrollToTop } from '@/components/ScrollToTop';
import { PASS_DAYS, PASS_PRICE_USD } from '@/hooks/usePass';

// The Pass's refund policy, as agreed on 2026-10-08 (SPEC §9, "Refunds").
// Its first line is the one RefundPromise puts beside the price wherever the
// Pass is sold, so the two must say the same thing.
//
// The promise is about viewings. Since #171 most renters buy the Pass before
// any agent has answered, so it covers every viewing asked for while the Pass
// runs, not only a plan bought to lock in. A Priority search that finds
// nothing is not covered (decided the same day). A person applies it, in
// Polar; the refund then ends the Pass by itself (handle-polar-webhooks).

const UPDATED = '8 October 2026';
const CONTACT = 'hello@hausto.com';

const Terms = () => (
  <>
    <ScrollToTop />
    <Helmet>
      <title>Refund policy - Hausto</title>
      <meta
        name="description"
        content="When the Hausto Pass is refunded: money back if we can't get you a single viewing."
      />
      <link rel="canonical" href="https://hausto.com/terms" />
    </Helmet>

    <main className="max-w-3xl mx-auto px-4 py-12">
      <Link
        to="/"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Hausto
      </Link>

      <h1 className="text-3xl font-bold mb-2 text-foreground">Refund policy</h1>
      <p className="text-sm text-muted-foreground mb-10">Last updated {UPDATED}</p>

      <section className="space-y-4 text-muted-foreground leading-relaxed">
        <p className="text-lg font-semibold text-foreground">
          Money back if we can't get you a single viewing.
        </p>
        <p>
          The Hausto Pass is ${PASS_PRICE_USD} for {PASS_DAYS} days, a one-off payment. If you ask us
          to arrange viewings while your Pass runs and none of them can go ahead - no agent
          confirms, the agent cancels, or the place is let before you see it - you choose one:
        </p>
        <ul className="list-disc pl-6 space-y-1">
          <li>a full refund of the Pass, or</li>
          <li>30 more days on your Pass.</li>
        </ul>
        <p>
          If a viewing we confirmed falls through - the agent cancels or doesn't come - we arrange
          another first.
        </p>
        <p>
          Tell us on WhatsApp, or at{' '}
          <a className="underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>, while your Pass runs or
          within 7 days after it ends. A refund goes back to the card you paid with, through Polar,
          our payment provider, within 5 working days. Your bank may take a few more days to show it.
        </p>
        <p>
          Once one of your viewings has gone ahead, the Pass is not refundable. Your first viewing is
          free, so there is nothing to refund on it. The promise is about viewings: a Priority search
          that finds nothing that fits is not refunded.
        </p>
        <p>
          We arrange viewings. We are not a party to your lease, and we are not responsible for the
          property or for what the landlord or the agent does.
        </p>
        <p>If something else went wrong, reply on WhatsApp and a person will look at it.</p>
      </section>
    </main>
  </>
);

export default Terms;
