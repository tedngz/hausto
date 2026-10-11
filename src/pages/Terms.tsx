import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { ScrollToTop } from '@/components/ScrollToTop';
import { PASS_DAYS, PASS_PRICE_USD } from '@/hooks/usePass';

// The Pass's refund policy, as agreed on 2026-10-11 (SPEC §9, "Refunds").
// Its two conditions are the line RefundPromise puts beside the price wherever
// the Pass is sold, so the two must say the same thing.
//
// The promise is about our work, not the agents' answers. The 2026-10-08
// version refunded a Pass under which no viewing could go ahead, which sold
// it as an outcome nobody controls. Now: unused within 7 days of buying, or
// no agent reached for a request within 3 days of it. A person applies it, in
// Polar; the refund then ends the Pass by itself (handle-polar-webhooks).

const UPDATED = '11 October 2026';
const CONTACT = 'hello@hausto.com';

const Terms = () => (
  <>
    <ScrollToTop />
    <Helmet>
      <title>Refund policy - Hausto</title>
      <meta
        name="description"
        content="When the Hausto Pass is refunded: within 7 days if you haven't used it, or if we can't reach the agents within 3 days of your request."
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
          The Pass pays for our work: reaching the agents for you, and searching for you.
        </p>
        <p>
          The Hausto Pass is ${PASS_PRICE_USD} for {PASS_DAYS} days, a one-off payment. While it runs we
          contact the agent for every place you ask us about, arrange the viewings they agree to, and
          run Extensive searches for you. We can't make an agent answer, keep a time, or hold a place
          for you, so the refund is about what we do, not about how many viewings go ahead.
        </p>
        <p>You get a full refund if:</p>
        <ul className="list-disc pl-6 space-y-1">
          <li>
            you ask within 7 days of buying, and since buying you haven't asked us to arrange a
            viewing, locked in a plan with it, or started an Extensive search, or
          </li>
          <li>
            we haven't reached the agent for any of the places in a request within 3 days of you
            making it.
          </li>
        </ul>
        <p>
          Once we have reached the agents or searched for you, the Pass is not refundable - whether or
          not an agent answers, keeps the time, or lets the place to someone else first. Nor is it
          refunded for parts of the Pass you didn't use. If a viewing we confirmed falls through - the
          agent cancels or doesn't come - we try to arrange another.
        </p>
        <p>
          Tell us on WhatsApp, or at{' '}
          <a className="underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>, while your Pass runs or
          within 7 days after it ends. A refund goes back to the card you paid with, through Polar,
          our payment provider, within 5 working days. Your bank may take a few more days to show it.
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
