import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { CalendarCheck, CheckCircle2, ExternalLink, Loader2, Phone, XCircle } from 'lucide-react';

// Ops queue for Fast-Track viewing requests. Coordinating a viewing is also
// when availability gets confirmed on a real call — so the per-listing
// "Confirmed live" / "Rented" buttons write back to external_properties,
// improving data freshness for every user, not just the paying one.

type FastTrackRow = {
  id: string;
  renter_id: string;
  property_ids: string[];
  preferred_dates: string[];
  preferred_times: string[];
  special_requirements: string | null;
  status: 'pending' | 'in_progress' | 'scheduled' | 'completed' | 'cancelled';
  source?: string;
  notes: string | null;
  created_at: string;
};

type ListingLite = {
  id: string;
  title: string;
  location: string;
  price: number | null;
  source_url: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  is_active: boolean | null;
  last_verified_at: string | null;
  isExternal: boolean;
};

const STATUS_FLOW: FastTrackRow['status'][] = ['pending', 'in_progress', 'scheduled', 'completed', 'cancelled'];

const STATUS_COLOR: Record<FastTrackRow['status'], string> = {
  pending: 'bg-amber-100 text-amber-800',
  in_progress: 'bg-blue-100 text-blue-800',
  scheduled: 'bg-violet-100 text-violet-800',
  completed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-gray-100 text-gray-600',
};

export const FastTrackQueuePanel = () => {
  const queryClient = useQueryClient();
  const [showClosed, setShowClosed] = useState(false);
  const [busyListing, setBusyListing] = useState<string | null>(null);

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['admin-fast-track', showClosed],
    queryFn: async () => {
      let q = supabase
        .from('fast_track_requests')
        .select('id, renter_id, property_ids, preferred_dates, preferred_times, special_requirements, status, source, notes, created_at')
        .order('created_at', { ascending: false })
        .limit(50);
      if (!showClosed) q = q.in('status', ['pending', 'in_progress', 'scheduled']);
      const { data, error } = await q;
      if (error) throw error;
      // `source` is newer than the generated Supabase types — cast through unknown.
      return (data || []) as unknown as FastTrackRow[];
    },
  });

  const allPropertyIds = Array.from(new Set(requests.flatMap((r) => r.property_ids)));

  const { data: listingMap = new Map<string, ListingLite>() } = useQuery({
    queryKey: ['admin-fast-track-listings', allPropertyIds.join(',')],
    enabled: allPropertyIds.length > 0,
    queryFn: async () => {
      const map = new Map<string, ListingLite>();
      // Contact columns are revoked from authenticated; fetch them via the
      // match/admin-gated RPC that every other consumer uses.
      const [ext, internal, contacts] = await Promise.all([
        supabase.from('external_properties')
          .select('id, title, location, price, source_url, is_active, last_verified_at')
          .in('id', allPropertyIds),
        supabase.from('properties')
          .select('id, title, location, price, is_active')
          .in('id', allPropertyIds),
        supabase.rpc('get_external_property_contacts', { _property_ids: allPropertyIds }),
      ]);
      const contactMap = new Map<string, { contact_name: string | null; contact_phone: string | null }>();
      for (const c of (contacts.data as any[]) || []) {
        contactMap.set(c.id, { contact_name: c.contact_name, contact_phone: c.contact_phone });
      }
      for (const p of ext.data || []) {
        const c = contactMap.get(p.id);
        map.set(p.id, { ...p, contact_name: c?.contact_name ?? null, contact_phone: c?.contact_phone ?? null, isExternal: true } as ListingLite);
      }
      for (const p of internal.data || []) {
        map.set(p.id, { ...p, source_url: null, contact_name: null, contact_phone: null, last_verified_at: null, isExternal: false } as ListingLite);
      }
      return map;
    },
  });

  // Renter identity so ops can reach out about scheduling
  const renterIds = Array.from(new Set(requests.map((r) => r.renter_id)));
  const { data: renterMap = new Map<string, { name: string | null; email: string | null }>() } = useQuery({
    queryKey: ['admin-fast-track-renters', renterIds.join(',')],
    enabled: renterIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.rpc('get_profiles_for_admin', { _user_ids: renterIds });
      return new Map(((data as any[]) || []).map((p: any) => [p.id, { name: p.name, email: p.email }]));
    },
  });

  const refetchAll = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-fast-track'] });
    queryClient.invalidateQueries({ queryKey: ['admin-fast-track-listings'] });
  };

  const setStatus = async (id: string, status: FastTrackRow['status']) => {
    const { error } = await supabase.from('fast_track_requests').update({ status }).eq('id', id);
    if (error) toast.error(`Update failed: ${error.message}`);
    else { toast.success(`Request marked ${status.replace('_', ' ')}`); refetchAll(); }
  };

  // Availability write-back from the coordination call
  const markListing = async (listingId: string, outcome: 'live' | 'rented') => {
    setBusyListing(listingId);
    const now = new Date().toISOString();
    const update = outcome === 'live'
      ? { last_verified_at: now, last_verification_status: 'alive', last_verification_reason: 'ops_confirmed', verification_failures: 0, is_active: true }
      : { is_active: false, deactivated_at: now, last_verified_at: now, last_verification_status: 'dead', last_verification_reason: 'ops_rented' };
    const { error } = await supabase.from('external_properties').update(update).eq('id', listingId);
    setBusyListing(null);
    if (error) toast.error(`Write-back failed: ${error.message}`);
    else { toast.success(outcome === 'live' ? 'Listing confirmed live' : 'Listing marked rented'); refetchAll(); }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CalendarCheck className="w-5 h-5" />
              Fast-Track viewing queue
            </CardTitle>
            <CardDescription>
              Confirm availability with agents, schedule viewings, and write availability back to listings.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowClosed((v) => !v)}>
            {showClosed ? 'Open requests' : 'Show closed'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : requests.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No {showClosed ? '' : 'open '}requests.</p>
        ) : (
          <div className="space-y-3">
            {requests.map((req) => {
              const renter = renterMap.get(req.renter_id);
              return (
              <div key={req.id} className="rounded-lg border p-3 space-y-2">
                {/* One-line header: who, when they want to view, status */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{renter?.name || 'Renter'}</span>
                  {renter?.email && (
                    <a href={`mailto:${renter.email}`} className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">
                      {renter.email}
                    </a>
                  )}
                  <span className="text-xs text-muted-foreground">
                    wants {req.preferred_dates.join(', ')}{req.preferred_times.filter(Boolean).length > 0 && ` (${req.preferred_times.filter(Boolean).join(', ')})`}
                  </span>
                  <div className="ml-auto">
                    <Select value={req.status} onValueChange={(v) => setStatus(req.id, v as FastTrackRow['status'])}>
                      <SelectTrigger className={`h-7 w-[130px] text-xs border-0 ${STATUS_COLOR[req.status]}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STATUS_FLOW.map((s) => <SelectItem key={s} value={s}>{s.replace('_', ' ')}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {req.special_requirements && (
                  <p className="text-xs text-muted-foreground">Note: {req.special_requirements}</p>
                )}

                {/* Per listing: everything ops needs for the call, one line */}
                <div className="divide-y divide-border/60">
                  {req.property_ids.map((pid) => {
                    const l = listingMap.get(pid);
                    if (!l) return (
                      <p key={pid} className="text-xs text-muted-foreground py-1.5">A requested listing was removed</p>
                    );
                    return (
                      <div key={pid} className="flex items-center gap-2 py-1.5 text-sm">
                        <span className={`line-clamp-1 flex-1 min-w-[140px] ${l.is_active === false ? 'line-through text-muted-foreground' : ''}`}>
                          {l.title}
                        </span>
                        {l.price ? (
                          <span className="text-xs text-muted-foreground whitespace-nowrap">{(Number(l.price) / 1e6).toFixed(1)}M</span>
                        ) : null}
                        {l.contact_phone && (
                          <a
                            href={`tel:${l.contact_phone}`}
                            title={l.contact_name || 'Agent'}
                            className="flex items-center gap-1 text-xs text-primary whitespace-nowrap hover:underline"
                          >
                            <Phone className="w-3 h-3" />{l.contact_phone}
                          </a>
                        )}
                        {l.source_url && (
                          <a href={l.source_url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground flex-shrink-0" title="Open source listing">
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                        {l.isExternal && (
                          <span className="flex gap-1 flex-shrink-0">
                            <Button
                              size="icon" variant="outline" className="h-6 w-6" title="Confirmed live with the agent"
                              disabled={busyListing === pid}
                              onClick={() => markListing(pid, 'live')}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            </Button>
                            <Button
                              size="icon" variant="outline" className="h-6 w-6" title="Agent says it's rented"
                              disabled={busyListing === pid}
                              onClick={() => markListing(pid, 'rented')}
                            >
                              <XCircle className="w-3.5 h-3.5 text-red-500" />
                            </Button>
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );})}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
