import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { ScrollToTop } from '@/components/ScrollToTop';

// Written against the schema rather than from a boilerplate generator: every
// category below names a column or table that actually exists. A privacy
// policy describing data we do not hold is worse than none - it is a claim we
// would have to defend.
//
// Vietnam's Decree 13/2023/ND-CP (PDPD) is the governing instrument. This page
// is not legal advice and has not been reviewed by a lawyer; it describes the
// system honestly, which is the part engineering can be responsible for.
//
// The controller is named as "Hausto", a trading name rather than a registered
// entity, at the operator's direction. Worth knowing what that costs: a data
// subject exercising a right under the PDPD, and a reviewer at Meta checking
// who is accountable, both look for someone identifiable. A trading name with
// a contact address is the weaker version of that, and it is what should be
// revisited first if the business incorporates or a regulator asks.

const UPDATED = '16 September 2026';
const CONTACT = 'hello@hausto.com';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-xl font-semibold mb-3 text-foreground">{title}</h2>
      <div className="space-y-3 text-muted-foreground leading-relaxed">{children}</div>
    </section>
  );
}

const Privacy = () => (
  <>
    <ScrollToTop />
    <Helmet>
      <title>Privacy Policy - Hausto</title>
      <meta
        name="description"
        content="How Hausto collects, uses and protects personal data for rental viewing coordination in Ho Chi Minh City."
      />
      <link rel="canonical" href="https://www.hausto.com/privacy" />
    </Helmet>

    <main className="max-w-3xl mx-auto px-4 py-12">
      <Link
        to="/"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Hausto
      </Link>

      <h1 className="text-3xl font-bold mb-2 text-foreground">Privacy Policy</h1>
      <p className="text-sm text-muted-foreground mb-10">Last updated {UPDATED}</p>

      <Section title="Who we are">
        <p>
          <strong>Hausto</strong> is the data controller for the personal data described
          here, operating in Vietnam. You can reach us at{' '}
          <a className="underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>
        <p>
          Hausto helps renters in Ho Chi Minh City arrange property viewings. You shortlist
          listings, we confirm availability with the agents on your behalf, and we send you
          a viewing schedule over WhatsApp.
        </p>
      </Section>

      <Section title="What we collect">
        <p>When you request viewings:</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong>Your phone number</strong>, stored in international format. This is the
            only identifier we require, and it is how we reach you.
          </li>
          <li>
            <strong>Your name</strong>, if you give us one. Optional, and used only to
            address you in messages.
          </li>
          <li>
            <strong>Which listings you shortlisted</strong> and the times you said you were
            free.
          </li>
          <li>
            <strong>The WhatsApp messages between us</strong>, in both directions, including
            what you send and what we send you.
          </li>
          <li>
            <strong>A record of what happened to your request</strong> - which viewings were
            confirmed, which were not, and when we contacted you.
          </li>
        </ul>
        <p>
          If you create an account on the website, we also hold the email address you signed
          up with. If you look up an agent's number on a listing, we keep a record of which
          listing and when. If you buy a Pass, our payment processor handles the transaction and we
          keep a record that a purchase happened - <strong>we never see or store your card
          details</strong>.
        </p>
      </Section>

      <Section title="What we do not do">
        <p>
          <strong>We never give your phone number or your name to a property agent.</strong>{' '}
          Agents see only the listing and the times being requested. Everything passes
          through us, in both directions, and this is enforced in the software rather than
          left to staff discretion. If you call or message an agent yourself, using the number
          a listing shows, they will see your number - that contact is between you and them.
        </p>
        <p>
          We do not sell personal data. We do not share it for anyone else's advertising.
        </p>
      </Section>

      <Section title="Who else processes your data">
        <p>We use these services to run Hausto, and each sees only what it needs:</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong>Meta (WhatsApp Business Platform)</strong> - delivers messages between
            you and us. Meta processes your phone number and message content as the operator
            of WhatsApp.
          </li>
          <li>
            <strong>Supabase</strong> - hosts our database and backend.
          </li>
          <li>
            <strong>OpenAI</strong> - only when you ask us to find something in your own
            words over WhatsApp. That message text is sent to OpenAI to work out what you
            are looking for. Your phone number is not sent with it.
          </li>
          <li>
            <strong>Polar</strong> - processes payments, if you buy a Pass.
          </li>
        </ul>
        <p>
          Some of these process data outside Vietnam. We rely on their own safeguards for
          international transfers.
        </p>
      </Section>

      <Section title="Messages, and how to stop them">
        <p>
          We message you about viewings you asked for. If you have opted in separately, we
          may also send a weekly summary of new listings - that is a different thing, it
          needs its own consent, and asking for a viewing does not give it.
        </p>
        <p>
          <strong>Reply STOP, or DỪNG, at any time</strong> and we will stop messaging you.
          That applies to everything, including viewings already in progress, and it takes
          effect immediately rather than after the current conversation.
        </p>
      </Section>

      <Section title="How long we keep it">
        <p>
          We keep records of your requests while you are using Hausto and for a reasonable
          period afterwards, so that we can answer questions about a viewing that already
          happened and improve how the service works.
        </p>
        <p>
          You can ask us to delete your data at any time and we will do so unless we are
          required to keep something by law. Our internal record of what happened to a
          request is kept in an append-only log for correctness, so deletion means removing
          the data that identifies you rather than rewriting history.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          Under Decree 13/2023/ND-CP on Personal Data Protection you may ask us to: tell you
          what we hold about you; correct it; delete it; stop using it; or give you a copy.
          You may also withdraw consent at any time.
        </p>
        <p>
          Write to <a className="underline" href={`mailto:${CONTACT}`}>{CONTACT}</a> and we
          will respond as quickly as we can. There is no charge.
        </p>
      </Section>

      <Section title="Keeping it safe">
        <p>
          Access to renter data is restricted to the people who need it to coordinate
          viewings, enforced by the database rather than by policy. Data is encrypted in
          transit. No system is perfectly secure, and we will tell you promptly if something
          happens that affects you.
        </p>
      </Section>

      <Section title="Children">
        <p>
          Hausto is not intended for anyone under 16, and we do not knowingly collect their
          data. If you believe a child has given us personal data, contact us and we will
          remove it.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          If we change this policy we will update the date at the top. If a change
          materially affects how we use your data, we will tell you directly rather than
          relying on you re-reading this page.
        </p>
      </Section>

      <p className="text-sm text-muted-foreground border-t border-border pt-6">
        Questions about any of this: <a className="underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>
      </p>
    </main>
  </>
);

export default Privacy;
