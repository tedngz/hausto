import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, Building2, Mail, Phone, ExternalLink, MessageSquare, Send } from 'lucide-react';
import { toast } from 'sonner';

type Status = 'new' | 'contacted' | 'closed';

interface MessageRow {
  id: string;
  direction: 'inbound' | 'outbound';
  source: 'email' | 'dashboard' | 'system' | 'whatsapp';
  channel: 'EMAIL' | 'WHATSAPP';
  from_email: string | null;
  subject: string | null;
  body: string;
  created_at: string;
}

interface InquiryRow {
  id: string;
  /** Null for Priority search, which asks about an area: `area_label` says which. */
  complex_id: string | null;
  area_label: string | null;
  user_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  target_move_in_date: string;
  lease_duration_months: number;
  budget_usd_min: number | null;
  budget_usd_max: number | null;
  budget_max_vnd: number | null;
  channel: 'EMAIL' | 'WHATSAPP';
  whatsapp_confirmed_at: string | null;
  bedrooms_needed: number;
  has_pets: boolean;
  additional_notes: string | null;
  status: string;
  admin_notes: string | null;
  handled_at: string | null;
  notified_at: string | null;
  last_message_at: string | null;
  last_inbound_at: string | null;
  created_at: string;
  complexes: { name: string; slug: string; district: string | null } | null;
}

const vnd = (dong: number) => `${Math.round(dong).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ₫`;

const budgetLabel = (row: InquiryRow) =>
  row.budget_max_vnd != null
    ? `up to ${vnd(row.budget_max_vnd)}/mo`
    : row.budget_usd_min != null && row.budget_usd_max != null
      ? `$${row.budget_usd_min.toLocaleString()} - $${row.budget_usd_max.toLocaleString()}/mo`
      : 'no budget';

/**
 * When a WhatsApp request's free-form window shuts: 24 hours after the
 * renter's last message. After that WhatsApp only takes approved templates, so
 * a reply has to go by email - or wait for them to write again.
 */
const windowClosesAt = (row: InquiryRow): Date | null => {
  const last = row.last_inbound_at ?? row.whatsapp_confirmed_at;
  return last ? new Date(new Date(last).getTime() + 24 * 3600_000) : null;
};

const STATUS_LABELS: Record<Status, string> = {
  new: 'New',
  contacted: 'Contacted',
  closed: 'Closed',
};

// The email conversation on one request. Renters only ever see
// hello@hausto.com; replies sent from here and replies typed in Gmail both land
// on this thread, so it is the full record either way.
const InquiryThread = ({ inquiry }: { inquiry: InquiryRow }) => {
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const { data: messages, isLoading } = useQuery({
    queryKey: ['complex-inquiry-messages', inquiry.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('complex_inquiry_messages')
        .select('id, direction, source, channel, from_email, subject, body, created_at')
        .eq('inquiry_id', inquiry.id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as MessageRow[];
    },
    refetchInterval: 30_000,
  });

  // A WhatsApp request is answered on WhatsApp, while its window is open -
  // after that, not until the renter writes again. Email is only for the
  // requests made before it was retired.
  const whatsapp = inquiry.channel === 'WHATSAPP';
  const closes = whatsapp ? windowClosesAt(inquiry) : null;
  const windowOpen = !!closes && closes.getTime() > Date.now();
  const via: 'whatsapp' | 'email' | null = !whatsapp ? 'email' : windowOpen ? 'whatsapp' : null;

  const send = async () => {
    const body = draft.trim();
    if (!body || !via) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('concierge-email-reply', {
        // The key makes a double click one message on WhatsApp.
        body: { inquiryId: inquiry.id, body, key: crypto.randomUUID() },
      });
      if (error) {
        // A closed window or two unanswered messages come back as 409 with a
        // sentence meant for the admin.
        const detail = await (error as { context?: Response }).context?.json().catch(() => null);
        throw new Error(detail?.message ?? error.message);
      }
      if (data?.error) throw new Error(data.message ?? data.error);
      setDraft('');
      toast.success(via === 'whatsapp' ? `Sent to ${inquiry.full_name} on WhatsApp` : `Sent to ${inquiry.email}`);
      qc.invalidateQueries({ queryKey: ['complex-inquiry-messages', inquiry.id] });
      qc.invalidateQueries({ queryKey: ['complex-inquiries'] });
      qc.invalidateQueries({ queryKey: ['complex-inquiry-counts'] });
    } catch (e: any) {
      toast.error('Could not send', { description: e?.message ?? String(e) });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-md border bg-muted/20 p-3 space-y-3">
      {isLoading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !messages?.length ? (
        <p className="text-xs text-muted-foreground text-center py-2">
          No messages yet. Send the first reply below.
        </p>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`rounded-md p-2.5 text-sm ${
                m.direction === 'inbound' ? 'bg-background border' : 'bg-primary/5 border border-primary/20 ml-6'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className="text-xs font-medium">
                  {m.direction === 'inbound' ? (m.from_email ?? inquiry.full_name) : 'Hausto'}
                </span>
                {m.channel === 'WHATSAPP' && (
                  <Badge variant="outline" className="text-[10px] px-1 py-0">WhatsApp</Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  {new Date(m.created_at).toLocaleString()}
                </span>
                {m.source !== 'email' && (
                  <Badge variant="outline" className="text-[10px] px-1 py-0">
                    {m.source === 'dashboard' ? 'sent from dashboard' : 'automatic'}
                  </Badge>
                )}
                {m.source === 'email' && m.direction === 'outbound' && (
                  <Badge variant="outline" className="text-[10px] px-1 py-0">sent from Gmail</Badge>
                )}
              </div>
              <p className="whitespace-pre-wrap text-muted-foreground">{m.body}</p>
            </div>
          ))}
        </div>
      )}

      <Textarea
        rows={3}
        placeholder={
          via === 'whatsapp'
            ? `Reply to ${inquiry.full_name} on WhatsApp - sent from the Hausto number`
            : via === 'email'
              ? `Reply to ${inquiry.full_name} - sent from hello@hausto.com`
              : 'Their WhatsApp window has closed'
        }
        value={draft}
        disabled={!via}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {via === 'whatsapp' && closes
            ? `WhatsApp window open until ${closes.toLocaleString()}. One message with everything reads best.`
            : whatsapp
              ? 'It reopens when they write to us on WhatsApp.'
              : 'An email request, from before email was retired. Copied to your Gmail.'}
        </p>
        <Button size="sm" disabled={sending || !draft.trim() || !via} onClick={send}>
          {sending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
          {via === 'whatsapp' ? 'Send on WhatsApp' : 'Send reply'}
        </Button>
      </div>
    </div>
  );
};

// Concierge queue for "check active availability" requests submitted from a
// complex page. These arrive from signed-out visitors too, so the renter's own
// contact details on the row are the only way to reach them.
export const ConciergeRequestsPanel = () => {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Status>('new');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);

  const { data: counts } = useQuery({
    queryKey: ['complex-inquiry-counts'],
    queryFn: async () => {
      const entries = await Promise.all(
        (Object.keys(STATUS_LABELS) as Status[]).map(async (status) => {
          const { count } = await supabase
            .from('complex_inquiries')
            .select('id', { count: 'exact', head: true })
            .eq('status', status)
            // WhatsApp requests are worked in the ops console (PLAN-v3 S7.1), where
            // the operator never sees the renter's name or number.
            .eq('channel', 'EMAIL');
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
        .eq('channel', 'EMAIL')
        .order('last_message_at', { ascending: false, nullsFirst: false })
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
      toast.success('Notice re-sent');
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
          Email requests, from before availability requests moved to WhatsApp. New requests
          are worked in the ops console, under Availability.
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
                        {row.complexes?.name ?? (row.area_label ? `Area search: ${row.area_label}` : 'Unknown complex')}
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
                      {row.channel === 'WHATSAPP' && <Badge variant="secondary">WhatsApp</Badge>}
                      <Badge variant="outline">{row.bedrooms_needed >= 4 ? '4+' : row.bedrooms_needed} BR</Badge>
                      <Badge variant="outline">{budgetLabel(row)}</Badge>
                      {row.has_pets && <Badge variant="outline">Pets</Badge>}
                      {row.channel === 'WHATSAPP' && !row.notified_at && <Badge variant="destructive">Notice not sent</Badge>}
                      {row.last_inbound_at &&
                        row.last_inbound_at > (row.channel === 'WHATSAPP' ? row.whatsapp_confirmed_at ?? '' : row.created_at ?? '') && (
                        <Badge>Renter replied</Badge>
                      )}
                      {row.channel === 'WHATSAPP' && (() => {
                        const closes = windowClosesAt(row);
                        if (!closes) return null;
                        const hours = Math.floor((closes.getTime() - Date.now()) / 3600_000);
                        return hours >= 0
                          ? <Badge variant={hours < 4 ? 'destructive' : 'outline'}>Reply within {hours}h</Badge>
                          : <Badge variant="outline">Window closed</Badge>;
                      })()}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs uppercase text-muted-foreground mb-1">Contact</p>
                      {row.email && (
                        <a href={`mailto:${row.email}`} className="text-primary inline-flex items-center gap-1 hover:underline break-all">
                          <Mail className="h-3 w-3" /> {row.email}
                        </a>
                      )}
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

                  {openThreadId === row.id && <InquiryThread inquiry={row} />}

                  <Textarea
                    rows={2}
                    placeholder="Internal notes (units found, who you called…)"
                    value={notes[row.id] ?? row.admin_notes ?? ''}
                    onChange={(e) => setNotes((n) => ({ ...n, [row.id]: e.target.value }))}
                  />

                  <div className="flex flex-wrap gap-2 justify-end">
                    <Button
                      variant={openThreadId === row.id ? 'secondary' : 'outline'}
                      size="sm"
                      className="mr-auto"
                      onClick={() => setOpenThreadId(openThreadId === row.id ? null : row.id)}
                    >
                      <MessageSquare className="h-4 w-4 mr-1" />
                      {openThreadId === row.id ? 'Hide conversation' : row.channel === 'WHATSAPP' ? 'Reply on WhatsApp' : 'Reply by email'}
                    </Button>
                    {/* The notice mails once; this is for when that mail failed. */}
                    {row.channel === 'WHATSAPP' && !row.notified_at && (
                      <Button variant="ghost" size="sm" disabled={busyId === row.id} onClick={() => resendNotification(row)}>
                        Re-send notice
                      </Button>
                    )}
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
