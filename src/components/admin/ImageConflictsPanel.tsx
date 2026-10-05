import { useState } from 'react';
import { withAdminSources } from '@/lib/adminListingSources';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { CheckCircle2, ExternalLink, ImageOff, Loader2, XCircle } from 'lucide-react';

// Ops review queue for suspected bait / stolen-photo listings: the nightly
// dedupe flags listings that share photo fingerprints with another listing
// but claim a different location or room count. Flagged listings are quietly
// downranked in public search until resolved here.

type ConflictRow = {
  id: string;
  title: string;
  location: string;
  rooms: string | null;
  price: number | null;
  source: string;
  source_url: string | null;
  images: string[] | null;
};

export const ImageConflictsPanel = () => {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['admin-image-conflicts'],
    queryFn: async () => {
      // image_location_conflict is newer than the generated Supabase types
      const { data, error } = await (supabase
        .from('external_properties')
        .select('id, title, location, rooms, price, source, images')
        .eq('is_active', true) as any)
        .eq('image_location_conflict', true)
        .order('location')
        .limit(50);
      if (error) throw error;
      return (await withAdminSources((data || []) as { id: string }[])) as unknown as ConflictRow[];
    },
  });

  const refetch = () => queryClient.invalidateQueries({ queryKey: ['admin-image-conflicts'] });

  const deactivate = async (row: ConflictRow) => {
    setBusy(row.id);
    const { error } = await supabase.from('external_properties').update({
      is_active: false,
      deactivated_at: new Date().toISOString(),
      last_verification_status: 'dead',
      last_verification_reason: 'ops_bait_flagged',
    }).eq('id', row.id);
    setBusy(null);
    if (error) toast.error(`Failed: ${error.message}`);
    else { toast.success('Listing removed'); refetch(); }
  };

  const dismiss = async (row: ConflictRow) => {
    setBusy(row.id);
    const { error } = await supabase.from('external_properties')
      .update({ image_location_conflict: false } as any)
      .eq('id', row.id);
    setBusy(null);
    if (error) toast.error(`Failed: ${error.message}`);
    else { toast.success('Flag dismissed (nightly dedupe may re-flag if photos still overlap)'); refetch(); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ImageOff className="w-5 h-5" />
          Suspected bait listings
          {rows.length > 0 && <Badge variant="destructive">{rows.length}</Badge>}
        </CardTitle>
        <CardDescription>
          Same photos as another listing but a different claimed location or room count.
          Downranked in public search until reviewed here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No flagged listings.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-lg border p-2">
                {r.images?.[0] && (
                  <img loading="lazy" src={r.images[0]} alt="" className="w-14 h-10 rounded object-cover flex-shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium line-clamp-1">{r.title}</p>
                  <p className="text-xs text-muted-foreground line-clamp-1">
                    {r.location} · {r.rooms || '?'} · {r.price ? `${(Number(r.price) / 1e6).toFixed(1)}M VND` : '?'} · {r.source}
                  </p>
                </div>
                {r.source_url && (
                  <a href={r.source_url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground flex-shrink-0">
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
                <Button size="sm" variant="outline" className="h-7 text-xs flex-shrink-0" disabled={busy === r.id} onClick={() => dismiss(r)}>
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-600" /> Legit
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs text-destructive hover:text-destructive flex-shrink-0" disabled={busy === r.id} onClick={() => deactivate(r)}>
                  <XCircle className="w-3.5 h-3.5 mr-1" /> Remove
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
