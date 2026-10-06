import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Check, Crown, Minus } from 'lucide-react';
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
 * modal sells confirmed viewings, never request credits or counts. One row
 * per thing the plans differ on, in the order a renter meets them.
 */
const ROWS: { label: string; free: string | null; pass: string }[] = [
  { label: 'Viewing requests', free: 'Request any listing - we ask the agents', pass: 'Same' },
  { label: 'Confirmed viewings', free: 'The first one is on us', pass: 'Every one, in one itinerary on WhatsApp' },
  { label: 'Search for me', free: null, pass: "A person searches Facebook groups and agents' circles for you" },
  { label: 'New listings', free: null, pass: 'Places that fit you, on WhatsApp up to twice a week' },
  { label: 'AI search', free: '10 a day', pass: 'Unlimited' },
  { label: 'Listing analysis', free: 'Basic vibe analysis', pass: 'Deep Scan' },
];

const reasonMessages = {
  viewings: 'Lock in every viewing the agents confirm.',
  ai: "You've used your 10 AI requests for today.",
};

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

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl sm:text-2xl">
            <Crown className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            {pass?.active ? 'Your Hausto Pass' : 'Get the Hausto Pass'}
          </DialogTitle>
          {/* Only speaks up when there's a reason the renter landed here. */}
          <DialogDescription className={`text-sm sm:text-lg ${reason ? '' : 'sr-only'}`}>
            {reason ? reasonMessages[reason] : 'Compare the Hausto plans.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 mt-4 sm:mt-6">
          <Card className="relative">
            <CardHeader className="pb-4">
              <CardTitle className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                <span>Free</span>
                {/* Whichever plan is actually live wears this. */}
                {!pass?.active && <Badge variant="secondary">Current</Badge>}
              </CardTitle>
              <CardDescription>Ask about any place, see one free</CardDescription>
              <div className="text-2xl sm:text-3xl font-bold">$0</div>
            </CardHeader>
            <CardContent className="pt-0">
              <dl className="space-y-3">
                {ROWS.map(row => (
                  <div key={row.label} className="flex items-start gap-2">
                    {row.free
                      ? <Check className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                      : <Minus className="h-4 w-4 mt-0.5 text-muted-foreground/60 shrink-0" />}
                    <div>
                      <dt className="text-xs text-muted-foreground">{row.label}</dt>
                      <dd className="text-xs sm:text-sm">{row.free ?? 'No'}</dd>
                    </div>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          <Card className="relative border-primary bg-primary/5">
            <div className="absolute -top-2 left-1/2 -translate-x-1/2">
              <Badge className="bg-primary text-primary-foreground">Recommended</Badge>
            </div>
            <CardHeader className="pb-4">
              <CardTitle className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <Crown className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
                  Hausto Pass
                </span>
                {pass?.active && <Badge variant="secondary">Current</Badge>}
              </CardTitle>
              <CardDescription>Every viewing we confirm, for {PASS_DAYS} days</CardDescription>
              <div className="text-2xl sm:text-3xl font-bold">
                ${PASS_PRICE_USD}<span className="text-sm font-normal"> for {PASS_DAYS} days, one-off</span>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <dl className="space-y-3 mb-4 sm:mb-6">
                {ROWS.map(row => (
                  <div key={row.label} className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                    <div>
                      <dt className="text-xs text-muted-foreground">{row.label}</dt>
                      <dd className="text-xs sm:text-sm font-medium">{row.pass}</dd>
                    </div>
                  </div>
                ))}
              </dl>
              <DigestOptIn checked={digestOptIn} onChange={setDigestOptIn} className="mb-3" />
              <Button onClick={handleGetPass} disabled={loading} className="w-full" size="lg">
                {loading ? 'Processing...' : pass?.active ? `Extend by ${PASS_DAYS} days` : 'Get the Pass'}
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="text-center text-xs sm:text-sm text-muted-foreground mt-4 px-4">
          {/* No "cancel anytime" - nothing recurs, which is the better promise. */}
          <p>Requesting is free - you pay once a viewing is confirmed. One-off payment, nothing recurring.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
};
