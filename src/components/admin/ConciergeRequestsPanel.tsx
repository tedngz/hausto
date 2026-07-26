import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, Building2, Mail, Phone, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

type Status = 'new' | 'contacted' | 'closed';

interface InquiryRow {
  id: string;
  complex_id: string;
  user_id: string | null;
  full_name: string;
  email: string;
  phone: string | null;
  target_move_in_date: string;
  lease_duration_months: number;
  budget_usd_min: number;
  budget_usd_max: number;
  bedrooms_needed: number;
  has_pets: boolean;
  additional_notes: string | null;
  status: string;
  admin_notes: string | null;
  handled_at: string | null;
  notified_at: string | null;
  created_at: string;
  complexes: { name: string; slug: string; district: string | null } | null;
}

const STATUS_LABELS: Record<Status, string> = {
  new: 'New',
  contacted: 'Contacted',
  closed: 'Closed',
};

// Concierge queue for "check active availability" requests submitted from a
// complex page. These arrive from signed-out visitors too, so the renter's own
// contact details on the row are the only way to reach them.
export const ConciergeRequestsPanel = () => {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Status>('new');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: counts } = useQuery({
    queryKey: ['complex-inquiry-counts'],
    queryFn: async () => {
      const entries = await Promise.all(
        (Object.keys(STATUS_LABELS) as Status[]).map(async (status) => {
          const { count } = await supabase
            .from('complex_inquiries')
            .select('id', { count: 'exact', head: true })
            .eq('status', status);
          return [status, count ?? 0] as const;
        }),
      );
      return Object.fromEntries(entries) as Record<Status, number>;
    },
    refetchInterval: 60_000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['complex-inquiries', tab],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('complex_inquiries')
        .select('*, complexes(name, slug, district)')
        .eq('status', tab)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as InquiryRow[];
    },
    refetchInterval: 60_000,
  });

  const setStatus = async (row: InquiryRow, status: Status) => {
    setBusyId(row.id);
    const { error } = await supabase
      .from('complex_inquiries')
      .update({
        status,
        admin_notes: notes[row.id] ?? row.admin_notes ?? null,
        handled_at: status === 'new' ? null : row.handled_at ?? new Date().toISOString(),
      })
      .eq('id', row.id);
    setBusyId(null);
    if (error) {
      toast.error('Update failed', { description: error.message });
      return;
    }
    toast.success(`Marked ${STATUS_LABELS[status].toLowerCase()}`);
    qc.invalidateQueries({ queryKey: ['complex-inquiries'] });
    qc.invalidateQueries({ queryKey: ['complex-inquiry-counts'] });
  };

  const saveNotes = async (row: InquiryRow) => {
    setBusyId(row.id);
    const { error } = await supabase
      .from('complex_inquiries')
      .update({ admin_notes: notes[row.id] ?? null })
      .eq('id', row.id);
    setBusyId(null);
    if (error) {
      toast.error('Could not save notes', { description: error.message });
      return;
    }
    toast.success('Notes saved');
    qc.invalidateQueries({ queryKey: ['complex-inquiries'] });
  };

  const resendNotification = async (row: InquiryRow) => {
    setBusyId(row.id);
    try {
      const { error } = await supabase.functions.invoke('notify-complex-inquiry', {
        body: { inquiryId: row.id },
      });
      if (error) throw error;
      toast.success('Notification email re-sent');
      qc.invalidateQueries({ queryKey: ['complex-inquiries'] });
    } catch (e: any) {
      toast.error('Send failed', { description: e?.message ?? String(e) });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5" />
          Concierge availability requests
        </CardTitle>
        <CardDescription>
          Renters asking us to check live availability at a complex. Reply within 24 hours,
          then mark the request contacted or closed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={(v) => setTab(v as Status)}>
          <TabsList>
            {(Object.keys(STATUS_LABELS) as Status[]).map((s) => (
              <TabsTrigger key={s} value={s}>
                {STATUS_LABELS[s]}
                {counts?.[s] ? <span className="ml-1.5 text-xs text-muted-foreground">{counts[s]}</span> : null}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value={tab} className="mt-4 space-y-4">
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : !data?.length ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No {STATUS_LABELS[tab].toLowerCase()} requests.
              </p>
            ) : (
              data.map((row) => (
                <div key={row.id} className="rounded-lg border p-4 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {row.complexes?.name ?? 'Unknown complex'}
                        {row.complexes?.slug && (
                          <a
                            href={`/complexes/${row.complexes.slug}`}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-1.5 inline-flex text-primary align-middle"
                            aria-label="Open complex page"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {row.full_name} · {new Date(row.created_at).toLocaleString()}
                        {row.complexes?.district ? ` · ${row.complexes.district}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{row.bedrooms_needed} BR</Badge>
                      <Badge variant="outline">
                        ${row.budget_usd_min.toLocaleString()}–${row.budget_usd_max.toLocaleString()}/mo
                      </Badge>
                      {row.has_pets && <Badge variant="outline">Pets</Badge>}
                      {!row.notified_at && <Badge variant="destructive">Not emailed</Badge>}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs uppercase text-muted-foreground mb-1">Contact</p>
                      <a href={`mailto:${row.email}`} className="text-primary inline-flex items-center gap-1 hover:underline break-all">
                        <Mail className="h-3 w-3" /> {row.email}
                      </a>
                      {row.phone && (
                        <a href={`tel:${row.phone}`} className="ml-3 text-primary inline-flex items-center gap-1 hover:underline">
                          <Phone className="h-3 w-3" /> {row.phone}
                        </a>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        {row.user_id ? 'Signed-in renter' : 'Guest (not signed in)'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground mb-1">Timing</p>
                      <p>
                        Move-in {row.target_move_in_date} · {row.lease_duration_months}-month lease
                      </p>
                    </div>
                    {row.additional_notes && (
                      <div className="md:col-span-2">
                        <p className="text-xs uppercase text-muted-foreground mb-1">Renter notes</p>
                        <p className="whitespace-pre-wrap text-muted-foreground">{row.additional_notes}</p>
                      </div>
                    )}
                  </div>

                  <Textarea
                    rows={2}
                    placeholder="Internal notes (units found, who you called…)"
                    value={notes[row.id] ?? row.admin_notes ?? ''}
                    onChange={(e) => setNotes((n) => ({ ...n, [row.id]: e.target.value }))}
                  />

                  <div className="flex flex-wrap gap-2 justify-end">
                    <Button variant="ghost" size="sm" disabled={busyId === row.id} onClick={() => resendNotification(row)}>
                      Re-send email
                    </Button>
                    <Button variant="ghost" size="sm" disabled={busyId === row.id} onClick={() => saveNotes(row)}>
                      Save notes
                    </Button>
                    {tab !== 'new' && (
                      <Button variant="outline" size="sm" disabled={busyId === row.id} onClick={() => setStatus(row, 'new')}>
                        Reopen
                      </Button>
                    )}
                    {tab !== 'contacted' && (
                      <Button variant="outline" size="sm" disabled={busyId === row.id} onClick={() => setStatus(row, 'contacted')}>
                        Mark contacted
                      </Button>
                    )}
                    {tab !== 'closed' && (
                      <Button size="sm" disabled={busyId === row.id} onClick={() => setStatus(row, 'closed')}>
                        {busyId === row.id && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                        Close
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};
