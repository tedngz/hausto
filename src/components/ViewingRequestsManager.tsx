import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  CalendarCheck, CheckCircle2, ChevronDown, ExternalLink, Loader2,
  MessageSquareText, Phone, XCircle,
} from 'lucide-react';

// Shared viewing-request coordination surface for the admin tools and the
// realtor dashboard. Requests are grouped per renter; every action (confirm /
// suggest change / cancel) goes through the fast-track-action edge function,
// which updates the row AND notifies the renter in chat + email.

type RequestRow = {
  id: string;
  renter_id: string;
  realtor_id: string | null;
  conversation_id: string | null;
  property_ids: string[];
  preferred_dates: string[];
  preferred_times: string[];
  special_requirements: string | null;
  status: 'pending' | 'in_progress' | 'scheduled' | 'completed' | 'cancelled';
  scheduled_viewings: any[] | null;
  notes: string | null;
  created_at: string;
};

type ListingLite = {
  id: string;
  title: string;
  price: number | null;
  source_url: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  is_active: boolean | null;
  isExternal: boolean;
};

const STATUS_COLOR: Record<RequestRow['status'], string> = {
  pending: 'bg-amber-100 text-amber-800',
  in_progress: 'bg-blue-100 text-blue-800',
  scheduled: 'bg-violet-100 text-violet-800',
  completed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-gray-100 text-gray-600',
};

const OPEN_STATUSES: RequestRow['status'][] = ['pending', 'in_progress', 'scheduled'];

interface ViewingRequestsManagerProps {
  /** admin sees every request plus listing write-back; realtor sees their own */
  scope: 'admin' | 'realtor';
}

type ActionKind = 'confirm' | 'suggest' | 'cancel';

export const ViewingRequestsManager = ({ scope }: ViewingRequestsManagerProps) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showClosed, setShowClosed] = useState(false);
  const [busyListing, setBusyListing] = useState<string | null>(null);

  // Action dialog state
  const [actionReq, setActionReq] = useState<RequestRow | null>(null);
  const [actionKind, setActionKind] = useState<ActionKind>('confirm');
  const [actionMessage, setActionMessage] = useState('');
  const [slots, setSlots] = useState<{ date: string; time: string }[]>([{ date: '', time: '' }]);
  const [sending, setSending] = useState(false);

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['viewing-requests', scope, user?.id, showClosed],
    enabled: !!user?.id,
    refetchInterval: 30000,
    queryFn: async () => {
      let q = supabase
        .from('fast_track_requests')
        .select('id, renter_id, realtor_id, conversation_id, property_ids, preferred_dates, preferred_times, special_requirements, status, scheduled_viewings, notes, created_at')
        .order('created_at', { ascending: false })
        .limit(60);
      if (scope === 'realtor') q = q.eq('realtor_id', user!.id);
      if (!showClosed) q = q.in('status', OPEN_STATUSES);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as RequestRow[];
    },
  });

  const renterIds = Array.from(new Set(requests.map((r) => r.renter_id)));
  const { data: renterMap = new Map<string, { name: string | null; email: string | null }>() } = useQuery({
    queryKey: ['viewing-requests-renters', renterIds.join(',')],
    enabled: renterIds.length > 0,
    queryFn: async () => {
      // Admins can read profiles directly; realtors go through the matched-profiles RPC
      if (scope === 'admin') {
        const { data } = await supabase.from('profiles').select('id, name, email').in('id', renterIds);
        return new Map((data || []).map((p: any) => [p.id, { name: p.name, email: p.email }]));
      }
      const { data } = await supabase.rpc('get_matched_public_profiles', { user_ids: renterIds });
      return new Map((data || []).map((p: any) => [p.id, { name: p.name, email: null }]));
    },
  });

  const allPropertyIds = Array.from(new Set(requests.flatMap((r) => r.property_ids)));
  const { data: listingMap = new Map<string, ListingLite>() } = useQuery({
    queryKey: ['viewing-requests-listings', scope, allPropertyIds.join(',')],
    enabled: allPropertyIds.length > 0,
    queryFn: async () => {
      const map = new Map<string, ListingLite>();
      // Agent phone is admin-only (RLS); realtors see title/price via public columns
      const extCols = scope === 'admin'
        ? 'id, title, price, source_url, contact_name, contact_phone, is_active'
        : 'id, title, price, source_url, is_active';
      const [ext, internal] = await Promise.all([
        supabase.from('external_properties').select(extCols).in('id', allPropertyIds),
        supabase.from('properties').select('id, title, price, is_active').in('id', allPropertyIds),
      ]);
      for (const p of (ext.data || []) as any[]) {
        map.set(p.id, { contact_name: null, contact_phone: null, ...p, isExternal: true });
      }
      for (const p of (internal.data || []) as any[]) {
        map.set(p.id, { ...p, source_url: null, contact_name: null, contact_phone: null, isExternal: false });
      }
      return map;
    },
  });

  const refetchAll = () => queryClient.invalidateQueries({ queryKey: ['viewing-requests'] });

  const openAction = (req: RequestRow, kind: ActionKind) => {
    setActionReq(req);
    setActionKind(kind);
    setActionMessage('');
    // Seed confirm slots from the renter's preferred dates/times
    const seedDate = req.preferred_dates[0] || '';
    const seedTime = req.preferred_times.filter(Boolean)[0] || '';
    setSlots([{ date: seedDate, time: seedTime }]);
  };

  const submitAction = async () => {
    if (!actionReq) return;
    const validSlots = slots.filter((s) => s.date && s.time);
    if (actionKind === 'confirm' && validSlots.length === 0) {
      toast.error('Add at least one date + time slot');
      return;
    }
    if (actionKind !== 'confirm' && !actionMessage.trim()) {
      toast.error(actionKind === 'suggest' ? 'Describe the change you are proposing' : 'Give the renter a short reason');
      return;
    }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('fast-track-action', {
        body: {
          requestId: actionReq.id,
          action: actionKind,
          message: actionMessage.trim() || undefined,
          schedule: actionKind === 'confirm' ? validSlots : undefined,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const delivery = [data?.chatDelivered && 'chat', data?.emailDelivered && 'email'].filter(Boolean).join(' + ');
      toast.success(
        actionKind === 'confirm' ? 'Viewings confirmed' : actionKind === 'suggest' ? 'Change suggested' : 'Request cancelled',
        { description: delivery ? `Renter notified via ${delivery}.` : 'Saved. Renter sees it on their profile page.' },
      );
      setActionReq(null);
      refetchAll();
    } catch (e: any) {
      console.error('fast-track-action failed:', e);
      toast.error('Action failed', { description: e.message });
    } finally {
      setSending(false);
    }
  };

  // Availability write-back (admin only): coordination calls double as verification
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

  // ── Group requests per renter ──
  const grouped = new Map<string, RequestRow[]>();
  for (const r of requests) {
    (grouped.get(r.renter_id) ?? grouped.set(r.renter_id, []).get(r.renter_id)!).push(r);
  }

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {requests.length === 0 ? 'No viewing requests.' : `${grouped.size} renter${grouped.size === 1 ? '' : 's'} · ${requests.length} request${requests.length === 1 ? '' : 's'}`}
        </p>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowClosed((v) => !v)}>
          <ChevronDown className={`w-3.5 h-3.5 mr-1 transition-transform ${showClosed ? 'rotate-180' : ''}`} />
          {showClosed ? 'Open only' : 'Show closed'}
        </Button>
      </div>

      {[...grouped.entries()].map(([renterId, reqs]) => {
        const renter = renterMap.get(renterId);
        return (
          <div key={renterId} className="rounded-lg border">
            {/* Renter header: one block per person, however many requests */}
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b bg-muted/40 rounded-t-lg">
              <span className="text-sm font-medium">{renter?.name || 'Renter'}</span>
              {renter?.email && (
                <a href={`mailto:${renter.email}`} className="text-xs text-muted-foreground hover:text-foreground hover:underline underline-offset-2">
                  {renter.email}
                </a>
              )}
              <span className="text-xs text-muted-foreground ml-auto">
                {reqs.length} request{reqs.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="divide-y">
              {reqs.map((req) => (
                <div key={req.id} className="p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={STATUS_COLOR[req.status]}>{req.status.replace('_', ' ')}</Badge>
                    <span className="text-xs text-muted-foreground">
                      wants {req.preferred_dates.join(', ')}
                      {req.preferred_times.filter(Boolean).length > 0 && ` (${req.preferred_times.filter(Boolean).join(', ')})`}
                    </span>
                    {OPEN_STATUSES.includes(req.status) && (
                      <span className="flex flex-wrap gap-1.5 w-full sm:w-auto sm:ml-auto">
                        <Button size="sm" className="h-7 text-xs flex-1 sm:flex-none" onClick={() => openAction(req, 'confirm')}>
                          <CalendarCheck className="w-3.5 h-3.5 mr-1" /> Confirm
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs flex-1 sm:flex-none" onClick={() => openAction(req, 'suggest')}>
                          <MessageSquareText className="w-3.5 h-3.5 mr-1" /> Suggest change
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs flex-1 sm:flex-none text-destructive hover:text-destructive" onClick={() => openAction(req, 'cancel')}>
                          <XCircle className="w-3.5 h-3.5 mr-1" /> Cancel
                        </Button>
                      </span>
                    )}
                  </div>

                  {req.special_requirements && (
                    <p className="text-xs text-muted-foreground italic">"{req.special_requirements}"</p>
                  )}
                  {req.status === 'scheduled' && Array.isArray(req.scheduled_viewings) && req.scheduled_viewings.length > 0 && (
                    <p className="text-xs text-violet-700">
                      Confirmed: {req.scheduled_viewings.map((v: any) => `${v.date} ${v.time}`).join(' · ')}
                    </p>
                  )}
                  {req.notes && <p className="text-xs text-muted-foreground">Last note: {req.notes}</p>}

                  <div className="divide-y divide-border/60">
                    {req.property_ids.map((pid) => {
                      const l = listingMap.get(pid);
                      if (!l) return <p key={pid} className="text-xs text-muted-foreground py-1">A requested listing was removed</p>;
                      return (
                        <div key={pid} className="flex items-center gap-2 py-1 text-sm">
                          <span className={`line-clamp-1 flex-1 min-w-[140px] ${l.is_active === false ? 'line-through text-muted-foreground' : ''}`}>
                            {l.title}
                          </span>
                          {l.price ? <span className="text-xs text-muted-foreground whitespace-nowrap">{(Number(l.price) / 1e6).toFixed(1)}M</span> : null}
                          {scope === 'admin' && l.contact_phone && (
                            <a href={`tel:${l.contact_phone}`} title={l.contact_name || 'Agent'} className="flex items-center gap-1 text-xs text-primary whitespace-nowrap hover:underline">
                              <Phone className="w-3 h-3" />{l.contact_phone}
                            </a>
                          )}
                          {l.source_url && (
                            <a href={l.source_url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground flex-shrink-0" title="Open source listing">
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                          {scope === 'admin' && l.isExternal && (
                            <span className="flex gap-1 flex-shrink-0">
                              <Button size="icon" variant="outline" className="h-6 w-6" title="Confirmed live with the agent" disabled={busyListing === pid} onClick={() => markListing(pid, 'live')}>
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              </Button>
                              <Button size="icon" variant="outline" className="h-6 w-6" title="Agent says it's rented" disabled={busyListing === pid} onClick={() => markListing(pid, 'rented')}>
                                <XCircle className="w-3.5 h-3.5 text-red-500" />
                              </Button>
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* Action dialog: confirm schedule / suggest change / cancel */}
      <Dialog open={!!actionReq} onOpenChange={(o) => { if (!o) setActionReq(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {actionKind === 'confirm' ? 'Confirm viewing schedule'
                : actionKind === 'suggest' ? 'Suggest a change'
                : 'Cancel viewing request'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {actionKind === 'confirm' && (
              <div className="space-y-2">
                <Label>Confirmed slots</Label>
                {slots.map((s, i) => (
                  <div key={i} className="flex gap-2">
                    <Input type="date" value={s.date} onChange={(e) => setSlots((cur) => cur.map((x, j) => j === i ? { ...x, date: e.target.value } : x))} />
                    <Input placeholder="e.g. 10:00" value={s.time} onChange={(e) => setSlots((cur) => cur.map((x, j) => j === i ? { ...x, time: e.target.value } : x))} />
                    {slots.length > 1 && (
                      <Button size="icon" variant="ghost" className="flex-shrink-0" onClick={() => setSlots((cur) => cur.filter((_, j) => j !== i))}>
                        <XCircle className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setSlots((cur) => [...cur, { date: '', time: '' }])}>
                  + Add slot
                </Button>
              </div>
            )}
            <div>
              <Label htmlFor="vr-message">
                {actionKind === 'confirm' ? 'Note to the renter (optional)'
                  : actionKind === 'suggest' ? 'What should change?'
                  : 'Reason'}
              </Label>
              <Textarea
                id="vr-message"
                value={actionMessage}
                onChange={(e) => setActionMessage(e.target.value)}
                rows={3}
                className="mt-1"
                placeholder={actionKind === 'suggest' ? 'e.g. The agent is only free after 5pm - would Thursday evening work?' : undefined}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              The renter is notified in their Hausto chat{actionReq?.conversation_id ? '' : ' (no chat thread for this request)'} and by email.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setActionReq(null)}>Back</Button>
              <Button onClick={submitAction} disabled={sending} variant={actionKind === 'cancel' ? 'destructive' : 'default'}>
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> :
                  actionKind === 'confirm' ? 'Confirm & notify' : actionKind === 'suggest' ? 'Send suggestion' : 'Cancel & notify'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
