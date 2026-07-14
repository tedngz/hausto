import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MapPin } from 'lucide-react';

// Landing-page preview of the browse table: the freshest verified listings,
// rendered in the same row format so the landing "is" the product. Public
// endpoint, no auth — contacts stay gated.
const SEARCH_URL = 'https://gbgrwjdmytaksrztcyzs.supabase.co/functions/v1/public-property-search';
const PREVIEW_ROWS = 6;

type PreviewRow = {
  id: string;
  title: string;
  location: string;
  price_usd: number | null;
  rooms: string | null;
  size: string | null;
  images: string[];
  last_verified_at?: string | null;
  posting_count?: number;
};

const daysAgo = (iso?: string | null): number | null => {
  if (!iso) return null;
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d >= 0 ? d : null;
};

const districtOf = (location: string): string => {
  const parts = (location || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return location;
  return parts.slice(0, -1).slice(-2).join(', ');
};

export const LiveListingsPreview = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [verifiedThisWeek, setVerifiedThisWeek] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // External listings carry verification stamps; take the freshest.
        const res = await fetch(`${SEARCH_URL}?source=external&limit=50`);
        if (!res.ok) return;
        const data = await res.json();
        const results: PreviewRow[] = data.results || [];
        const sorted = [...results].sort((a, b) =>
          (b.last_verified_at || '').localeCompare(a.last_verified_at || ''));
        if (!cancelled) {
          setRows(sorted.slice(0, PREVIEW_ROWS));
          setTotal(data.total ?? null);
          setVerifiedThisWeek(results.filter((r) => {
            const d = daysAgo(r.last_verified_at);
            return d !== null && d <= 7;
          }).length);
        }
      } catch {
        // Preview is decorative — fail silently, section just doesn't render.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (rows.length === 0) return null;

  return (
    <div className="mt-12 text-left">
      <div className="mb-6 text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-2">Live Inventory</p>
        <h2 className="font-serif text-3xl md:text-4xl tracking-tight">Fresh, verified, no duplicates</h2>
        <p className="text-muted-foreground mt-3 max-w-xl mx-auto text-sm md:text-base">
          Every listing is re-checked against its source while it's on the market.
          Dead listings are removed, duplicate agent posts are merged.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card/80 backdrop-blur-sm overflow-hidden shadow-sm">
        {rows.map((r) => {
          const fresh = daysAgo(r.last_verified_at);
          return (
            <button
              key={r.id}
              className="w-full flex items-center gap-3 md:gap-4 px-4 py-3 border-b border-border last:border-b-0 hover:bg-secondary/40 transition-colors text-left"
              onClick={() => navigate(`/property/${r.id}`)}
            >
              {r.images?.[0] && (
                <img
                  src={r.images[0]}
                  alt=""
                  loading="lazy"
                  className="w-16 h-12 rounded-lg object-cover flex-shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm line-clamp-1">{r.title}</p>
                <p className="text-xs text-muted-foreground line-clamp-1 flex items-center gap-1 mt-0.5">
                  <MapPin className="w-3 h-3 flex-shrink-0" />
                  {districtOf(r.location)}
                  {r.rooms && <span className="hidden sm:inline"> · {r.rooms}</span>}
                </p>
              </div>
              {(r.posting_count || 1) > 1 && (
                <Badge variant="secondary" className="hidden md:inline-flex text-[10px]">
                  {r.posting_count} agents
                </Badge>
              )}
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-semibold whitespace-nowrap">
                  {r.price_usd ? `$${r.price_usd.toLocaleString()}` : '—'}
                  <span className="text-xs text-muted-foreground font-normal">/mo</span>
                </p>
                {fresh !== null && fresh <= 30 && (
                  <p className="text-[11px] text-emerald-600 flex items-center justify-end gap-1 whitespace-nowrap">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    verified {fresh === 0 ? 'today' : `${fresh}d ago`}
                  </p>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-5 flex flex-col sm:flex-row items-center justify-center gap-3">
        <Button asChild size="lg" className="px-8">
          <Link to="/browse">
            Browse {total ? `all ${total}` : 'all'} listings →
          </Link>
        </Button>
        {verifiedThisWeek > 0 && (
          <p className="text-xs text-muted-foreground">
            {verifiedThisWeek} listings verified live this week
          </p>
        )}
      </div>
    </div>
  );
};
