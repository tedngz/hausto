import { Card } from '@/components/ui/card';
import { useCurrency } from '@/contexts/CurrencyContext';
import type { Apartment } from '@/types';

// Per-bedroom asking-price bands for one building. Building + bedroom count is
// the only cut where crawl coverage is dense enough to say anything, because
// crawls run in project mode.
//
// The threshold is enforced here rather than in the caller: a band computed off
// two listings is noise, and publishing noise as insight is more expensive than
// showing nothing. Below MIN_SAMPLE the bedroom row simply does not render, and
// if no row qualifies the whole section disappears.

const MIN_SAMPLE = 5;

interface ComplexPriceBandsProps {
  listings: Apartment[] | undefined;
  complexName: string;
}

interface Band {
  label: string;
  n: number;
  low: number;
  typical: number;
  high: number;
}

/** "2 Bedrooms", "2BR", "studio" all have to collapse to one bucket. */
function bedroomLabel(rooms: string | null | undefined): string | null {
  if (!rooms) return null;
  const r = rooms.toLowerCase();
  if (r.includes('studio')) return 'Studio';
  const m = r.match(/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1 || n > 6) return null;
  return n === 1 ? '1 bedroom' : `${n} bedrooms`;
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function buildBands(listings: Apartment[]): Band[] {
  const buckets = new Map<string, number[]>();
  for (const l of listings) {
    const label = bedroomLabel(l.rooms);
    const price = Number(l.price) || 0;
    if (!label || price <= 0) continue;
    const arr = buckets.get(label) || [];
    arr.push(price);
    buckets.set(label, arr);
  }

  const bands: Band[] = [];
  for (const [label, prices] of buckets) {
    if (prices.length < MIN_SAMPLE) continue;
    const sorted = [...prices].sort((a, b) => a - b);
    bands.push({
      label,
      n: sorted.length,
      low: sorted[0],
      typical: median(sorted),
      high: sorted[sorted.length - 1],
    });
  }
  return bands.sort((a, b) => a.label.localeCompare(b.label));
}

function freshness(listings: Apartment[]): string | null {
  // last_activated_at carries the crawl time for external listings and is
  // present on both the signed-in and anonymous fetch paths; last_verified_at
  // only comes back for signed-in users, so it is the fallback rather than the
  // primary, otherwise the line would appear only for half the audience.
  const stamps = listings
    .map((l) => l.last_activated_at ?? l.last_verified_at ?? null)
    .filter((s): s is string => !!s)
    .sort();
  if (stamps.length === 0) return null;
  const latest = new Date(stamps[stamps.length - 1]);
  const days = Math.floor((Date.now() - latest.getTime()) / 86400000);
  if (days <= 0) return 'checked today';
  if (days === 1) return 'checked yesterday';
  return `checked ${days} days ago`;
}

export function ComplexPriceBands({ listings, complexName }: ComplexPriceBandsProps) {
  const { formatPrice } = useCurrency();
  if (!listings || listings.length === 0) return null;

  const bands = buildBands(listings);
  if (bands.length === 0) return null;

  const checked = freshness(listings);

  return (
    <Card className="p-5">
      <h3 className="font-serif text-lg mb-1">Asking prices at {complexName}</h3>
      <p className="text-xs text-muted-foreground mb-4">
        From listings we currently track at this building{checked ? `, ${checked}` : ''}. Asking
        prices, not signed rents.
      </p>

      <div className="space-y-3">
        {bands.map((b) => (
          <div key={b.label}>
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-sm font-medium">{b.label}</span>
              <span className="text-xs text-muted-foreground">{b.n} listings</span>
            </div>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground">{formatPrice(b.low)}</span>
              <span className="font-semibold">{formatPrice(b.typical)}</span>
              <span className="text-muted-foreground">{formatPrice(b.high)}</span>
            </div>
            <div className="flex items-baseline justify-between text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">
              <span>low</span>
              <span>typical</span>
              <span>high</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
