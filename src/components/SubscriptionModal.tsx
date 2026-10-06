import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, Crown } from 'lucide-react';
import { DigestOptIn } from '@/components/DigestOptIn';
import { useAuth } from '@/hooks/useAuth';
import { PASS_DAYS, PASS_PRICE_USD, usePass } from '@/hooks/usePass';
import { toast } from 'sonner';

interface SubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Why the renter landed here, if a limit sent them. */
  reason?: 'viewings' | 'ai';
}

/**
 * The two plans, as the pricing rework set them (SPEC §9).
 *
 * Requests are free on both: we ask the agents either way. What a renter pays
 * for is a viewing that happens - locked in once agents confirm - so the
 * modal sells confirmed viewings, never request credits or counts.
 *
 * The Pass lists only what it adds over Free. A row-for-row comparison made
 * every line say "Same" or "No" on one side, which was most of the reading
 * and none of the information. Each line leads with the thing, then the
 * detail, so a renter can read the bold words alone.
 */
type Feature = { lead: string; rest?: string };

const FREE: Feature[] = [
  { lead: 'Request any listing', rest: ' - we ask the agents' },
  { lead: 'First confirmed viewing', rest: ' on us' },
  { lead: 'AI search', rest: ', 10 a day' },
  { lead: 'Basic vibe analysis' },
];

const PASS: Feature[] = [
  { lead: 'Every confirmed viewing', rest: ', not just the first' },
  { lead: 'Search for me', rest: " - a person checks Facebook groups and agents' circles" },
  { lead: 'New listings that fit you', rest: ', on WhatsApp up to twice a week' },
  { lead: 'Unlimited AI search' },
  { lead: 'Deep Scan', rest: ' on any listing' },
];

const reasonMessages = {
  viewings: 'Lock in every viewing the agents confirm.',
  ai: "You've used your 10 AI searches for today.",
};

const FeatureList = ({ features, accent }: { features: Feature[]; accent?: boolean }) => (
  <ul className="space-y-2.5 text-sm">
    {features.map(({ lead, rest }) => (
      <li key={lead} className="flex items-start gap-2.5">
        <Check className={`h-4 w-4 mt-0.5 shrink-0 ${accent ? 'text-primary' : 'text-muted-foreground'}`} aria-hidden="true" />
        <span className="text-muted-foreground leading-snug">
          <span className="font-medium text-foreground">{lead}</span>
          {rest}
        </span>
      </li>
    ))}
  </ul>
);

export const SubscriptionModal = ({ isOpen, onClose, reason }: SubscriptionModalProps) => {
  const { user } = useAuth();
  const { pass, purchasePass } = usePass();
  const [loading, setLoading] = useState(false);
  const [digestOptIn, setDigestOptIn] = useState(false);

  // A one-off Polar checkout - purchasePass redirects there itself.
  const handleGetPass = async () => {
    if (!user) {
      toast.error('Please log in to get the Pass');
      return;
    }
    setLoading(true);
    try {
      await purchasePass(undefined, { digestOptIn });
    } finally {
      setLoading(false);
    }
  };

  // A complimentary pass never runs out, so it has no days to count.
  const daysLeft = pass?.active && !pass.isComplimentary && pass.daysLeft > 0 ? pass.daysLeft : null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="pr-6">
          <DialogTitle className="flex items-center gap-2 font-serif text-2xl">
            <Crown className="h-5 w-5 text-primary" aria-hidden="true" />
            {pass?.active ? 'Your Hausto Pass' : 'Get the Hausto Pass'}
          </DialogTitle>
          {/* The model is the part nobody guesses, so it is said once, up
              here, before either plan. A renter a limit sent here reads why
              instead. */}
          <DialogDescription className="text-sm sm:text-base">
            {reason
              ? reasonMessages[reason]
              : pass?.active
                ? 'Your Pass covers every viewing we confirm while it runs.'
                : 'Requesting is free, and so is your first confirmed viewing. The Pass covers every one after that.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
          <section className="flex flex-col rounded-2xl border border-border bg-card p-5 sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold">Free</h3>
              {/* Stacked on a phone, where the button below is not shown. */}
              {!pass?.active && <Badge variant="secondary" className="md:hidden">Current</Badge>}
            </div>
            <p className="mt-3 font-serif text-3xl font-semibold tracking-tight">$0</p>
            <p className="mt-1 text-xs text-muted-foreground">No card needed</p>
            <div className="my-5 border-t border-border" />
            <FeatureList features={FREE} />
            {/* Level with the Pass's button, so side by side the two cards end
                on one line. Stacked, it would only push the Pass further down. */}
            {!pass?.active && (
              <div className="mt-auto hidden pt-6 md:block">
                <Button variant="outline" size="lg" className="w-full rounded-full" disabled>
                  Your current plan
                </Button>
              </div>
            )}
          </section>

          <section className="flex flex-col rounded-2xl border border-primary bg-primary/5 p-5 sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-lg font-semibold">
                <Crown className="h-4 w-4 text-primary" aria-hidden="true" />
                Hausto Pass
              </h3>
              {pass?.active ? (
                <Badge variant="secondary">{daysLeft ? `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left` : 'Current'}</Badge>
              ) : (
                <Badge className="bg-primary text-primary-foreground hover:bg-primary">Recommended</Badge>
              )}
            </div>
            <p className="mt-3 font-serif text-3xl font-semibold tracking-tight">
              ${PASS_PRICE_USD}
              <span className="font-sans text-sm font-normal text-muted-foreground"> for {PASS_DAYS} days</span>
            </p>
            {/* No "cancel anytime" - nothing recurs, which is the better promise. */}
            <p className="mt-1 text-xs text-muted-foreground">One-off payment, nothing recurring</p>
            <div className="my-5 border-t border-primary/20" />
            <p className="mb-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Everything in Free, plus</p>
            <FeatureList features={PASS} accent />
            <div className="mt-auto pt-6 space-y-3">
              <DigestOptIn checked={digestOptIn} onChange={setDigestOptIn} />
              <Button onClick={handleGetPass} disabled={loading} className="w-full rounded-full" size="lg">
                {loading ? 'Processing...' : pass?.active ? `Extend by ${PASS_DAYS} days` : `Get the Pass - $${PASS_PRICE_USD}`}
              </Button>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
};
