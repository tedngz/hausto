import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

/**
 * The digest's consent, on our page before Polar's checkout (SPEC §11).
 *
 * Unticked by default and never inferred from buying: the digest arrives
 * unbidden, as Marketing, from the number the itineraries use, so a renter who
 * did not ask for it and reports it costs every renter's messages.
 */
export function DigestOptIn({ checked, onChange, className }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-2 text-xs text-muted-foreground', className)}>
      <Checkbox
        checked={checked}
        onCheckedChange={v => onChange(v === true)}
        className="mt-0.5"
        aria-label="Send me new places that fit, on WhatsApp"
      />
      <span>
        Send me new places that fit what I am looking for, on WhatsApp, up to twice a week while my Pass runs.
        Reply STOP to end them.
      </span>
    </label>
  );
}
