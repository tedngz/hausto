import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, Crown } from 'lucide-react';
import { DigestOptIn } from '@/components/DigestOptIn';
import { RefundPromise } from '@/components/RefundPromise';
import { useAuth } from '@/hooks/useAuth';
import { PASS_DAYS, PASS_PRICE_USD, usePass } from '@/hooks/usePass';
import { FREE_TIER_LIMITS } from '@/hooks/useUsageTracking';
import { toast } from 'sonner';

interface SubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Why the renter landed here, if a limit sent them. */
  reason?: 'viewings' | 'ai';
}

/**
 * The two plans (SPEC §9; owner's decision, 2026-10-07).
 *
 * Having us arrange viewings is the Pass's. Free gets a taste - one place,
 * once per WhatsApp number (requestGate) - and the agents' numbers to call
 * itself (SPEC §6); the Pass sells not having to, for every place and every
 * building. Never request credits or counts.
 *
 * What Hausto is for - dealing with the agents, in the local language, without the
 * renter's number reaching them - is said once, in the header.
 *
 * The Pass lists only what it adds over Free. A row-for-row comparison made
 * every line say "Same" or "No" on one side, which was most of the reading
 * and none of the information. Each line leads with the amount, in bold -
 * "1 free viewing", "Unlimited AI credits" - so the bold words
 * alone compare the plans, and any detail follows in muted text.
 */
type Feature = { lead: string; rest?: string };

const AI_CREDITS = FREE_TIER_LIMITS.dailyAiRequests;

const FREE: Feature[] = [
  { lead: '1 free viewing', rest: ' - we arrange one place with its agent' },
  { lead: "Agents' numbers", rest: ' - where the ad lists one, to call yourself' },
  { lead: `${AI_CREDITS} AI credits`, rest: ' a day' },
  { lead: 'Basic vibe analysis' },
];

const PASS: Feature[] = [
  { lead: 'Unlimited viewings arranged', rest: ' - every agent dealt with, one plan on WhatsApp' },
  { lead: 'Availability at any building', rest: ' - we ask the agents who hold units there' },
  { lead: 'Priority search', rest: ' - our team puts your search first and sends you places that fit' },
  { lead: 'Match alerts', rest: ' - new places that fit you, up to 2 a week on WhatsApp' },
  { lead: 'Unlimited AI credits' },
  { lead: 'Unlimited Deep Scans' },
];

const reasonMessages = {
  viewings: 'Have us arrange every viewing you want.',
  ai: `You've used today's ${AI_CREDITS} AI credits.`,
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
                : 'We deal with the agents for you, in the local language, and your number never reaches them. Your first viewing is on us - the Pass has us arrange every one after that.'}
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
            <RefundPromise className="mt-1" />
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
