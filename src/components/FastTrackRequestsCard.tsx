import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Archive, ArchiveRestore, CalendarCheck, Loader2, Pencil, Trash2, XCircle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// Renter-facing view of their Fast-Track viewing requests. Requests are
// editable/cancellable while still pending (RLS enforces the same rule).

type RequestRow = {
  id: string;
  property_ids: string[];
  preferred_dates: string[];
  preferred_times: string[];
  special_requirements: string | null;
  status: 'pending' | 'in_progress' | 'scheduled' | 'completed' | 'cancelled';
  scheduled_viewings: any[];
  created_at: string;
  archived_at: string | null;
};

// Pending/cancelled requests are the renter's to delete outright; the rest are
// live booking records, so those can only be archived out of the list.
const isDeletable = (s: RequestRow['status']) => s === 'pending' || s === 'cancelled';

const STATUS_COLOR: Record<RequestRow['status'], string> = {
  pending: 'bg-amber-100 text-amber-800',
  in_progress: 'bg-blue-100 text-blue-800',
  scheduled: 'bg-violet-100 text-violet-800',
  completed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-gray-100 text-gray-600',
};

const STATUS_LABEL: Record<RequestRow['status'], string> = {
  pending: 'Pending - we are contacting the agents',
  in_progress: 'In progress',
  scheduled: 'Viewings scheduled',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const FastTrackRequestsCard = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<RequestRow | null>(null);
  const [editDates, setEditDates] = useState('');
  const [editTimes, setEditTimes] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RequestRow | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['my-fast-track-requests', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fast_track_requests')
        .select('id, property_ids, preferred_dates, preferred_times, special_requirements, status, scheduled_viewings, created_at, archived_at')
        .eq('renter_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data || []) as unknown as RequestRow[];
    },
  });

  const allIds = Array.from(new Set(requests.flatMap((r) => r.property_ids)));
  const { data: titles = new Map<string, string>() } = useQuery({
    queryKey: ['my-fast-track-titles', allIds.join(',')],
    enabled: allIds.length > 0,
    queryFn: async () => {
      const map = new Map<string, string>();
      const [ext, internal] = await Promise.all([
        supabase.from('external_properties').select('id, title').in('id', allIds),
        supabase.from('properties').select('id, title').in('id', allIds),
      ]);
      for (const p of [...(ext.data || []), ...(internal.data || [])]) map.set(p.id, p.title);
      return map;
    },
  });

  const refetch = () => queryClient.invalidateQueries({ queryKey: ['my-fast-track-requests'] });

  const openEdit = (req: RequestRow) => {
    setEditing(req);
    setEditDates(req.preferred_dates.join(', '));
    setEditTimes(req.preferred_times.filter(Boolean).join(', '));
    setEditNotes(req.special_requirements || '');
  };

  const saveEdit = async () => {
    if (!editing) return;
    const dates = editDates.split(',').map((s) => s.trim()).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
    if (dates.length === 0) {
      toast.error('Enter at least one date as YYYY-MM-DD');
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('fast_track_requests')
      .update({
        preferred_dates: dates,
        preferred_times: editTimes.split(',').map((s) => s.trim()).filter(Boolean),
        special_requirements: editNotes.trim() || null,
      })
      .eq('id', editing.id);
    setSaving(false);
    if (error) {
      toast.error(`Could not save: ${error.message}`);
    } else {
      toast.success('Request updated');
      setEditing(null);
      refetch();
    }
  };

  const cancelRequest = async (req: RequestRow) => {
    const { error } = await supabase
      .from('fast_track_requests')
      .update({ status: 'cancelled' })
      .eq('id', req.id);
    if (error) toast.error(`Could not cancel: ${error.message}`);
    else { toast.success('Request cancelled'); refetch(); }
  };

  // Only pending/cancelled rows are deletable — RLS enforces the same rule, so
  // a blocked delete comes back as 0 rows rather than an error.
  const deleteRequest = async (req: RequestRow) => {
    setDeletingId(req.id);
    const { data, error } = await supabase
      .from('fast_track_requests')
      .delete()
      .eq('id', req.id)
      .select('id');
    setDeletingId(null);
    if (error) {
      toast.error(`Could not delete: ${error.message}`);
    } else if (!data || data.length === 0) {
      toast.error('Could not delete this request. Please refresh and try again.');
    } else {
      toast.success('Request deleted');
      refetch();
    }
  };

  // Scheduled/in-progress/completed requests stay on record, so renters archive
  // them out of the list instead.
  const setArchived = async (req: RequestRow, archived: boolean) => {
    setArchivingId(req.id);
    const { data, error } = await supabase.rpc('set_fast_track_archived', {
      _request_id: req.id,
      _archived: archived,
    });
    setArchivingId(null);
    if (error) {
      toast.error(`Could not ${archived ? 'archive' : 'restore'}: ${error.message}`);
    } else if (!data || (Array.isArray(data) && data.length === 0)) {
      toast.error('Could not update this request. Please refresh and try again.');
    } else {
      toast.success(archived ? 'Request archived' : 'Request restored');
      refetch();
    }
  };

  if (!user) return null;

  const archivedCount = requests.filter((r) => r.archived_at).length;
  const visible = showArchived ? requests : requests.filter((r) => !r.archived_at);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <CalendarCheck className="w-5 h-5" />
          Fast-Track viewing requests
        </CardTitle>
        <CardDescription>Hausto coordinates these viewings with the agents for you.</CardDescription>
        {archivedCount > 0 && (
          <Button
            variant="link"
            className="h-auto p-0 justify-start text-xs w-fit"
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {requests.length === 0
              ? 'No viewing requests yet. Shortlist listings from Browse and hit "Request viewings".'
              : 'No active viewing requests - the rest are archived.'}
          </p>
        ) : (
          <div className="space-y-3">
            {visible.map((req) => (
              <div key={req.id} className={`rounded-lg border p-3 space-y-2 ${req.archived_at ? 'opacity-70' : ''}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={STATUS_COLOR[req.status]}>{STATUS_LABEL[req.status]}</Badge>
                  {req.archived_at && <Badge variant="outline" className="text-xs">Archived</Badge>}
                  <span className="text-xs text-muted-foreground ml-auto">
                    {new Date(req.created_at).toLocaleDateString()}
                  </span>
                </div>
                <ul className="text-sm space-y-0.5">
                  {req.property_ids.map((pid) => {
                    const title = titles.get(pid);
                    return (
                      <li key={pid} className="line-clamp-1">
                        •{' '}
                        {title ? (
                          <a
                            href={`/property/${pid}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-primary underline decoration-border underline-offset-4 hover:decoration-primary transition-colors"
                          >
                            {title}
                          </a>
                        ) : (
                          <span className="text-muted-foreground">Listing no longer available</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Dates: {req.preferred_dates.join(', ')}
                  {req.preferred_times.filter(Boolean).length > 0 && <> · Times: {req.preferred_times.filter(Boolean).join(', ')}</>}
                  {req.special_requirements && <> · Notes: {req.special_requirements}</>}
                </p>
                {Array.isArray(req.scheduled_viewings) && req.scheduled_viewings.length > 0 && (
                  <div className="rounded bg-secondary/50 p-2 text-xs">
                    <p className="font-medium mb-1">Confirmed schedule:</p>
                    {req.scheduled_viewings.map((v: any, i: number) => (
                      <p key={i}>{typeof v === 'string' ? v : `${v.date ?? ''} ${v.time ?? ''} ${v.property_title ?? ''}`.trim()}</p>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  {req.status === 'pending' && (
                    <>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openEdit(req)}>
                        <Pencil className="w-3 h-3 mr-1" /> Change
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => cancelRequest(req)}>
                        <XCircle className="w-3 h-3 mr-1" /> Cancel
                      </Button>
                    </>
                  )}
                  {isDeletable(req.status) ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs text-destructive hover:text-destructive"
                      disabled={deletingId === req.id}
                      onClick={() => setConfirmDelete(req)}
                    >
                      {deletingId === req.id
                        ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        : <Trash2 className="w-3 h-3 mr-1" />}
                      Delete
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={archivingId === req.id}
                      onClick={() => setArchived(req, !req.archived_at)}
                    >
                      {archivingId === req.id
                        ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        : req.archived_at
                          ? <ArchiveRestore className="w-3 h-3 mr-1" />
                          : <Archive className="w-3 h-3 mr-1" />}
                      {req.archived_at ? 'Restore' : 'Archive'}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this viewing request?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.status === 'pending'
                ? 'This withdraws the request and removes it for good. If you only want to stop it going ahead, use Cancel instead.'
                : 'This removes the cancelled request from your list for good.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => { if (confirmDelete) deleteRequest(confirmDelete); setConfirmDelete(null); }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit viewing request</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="ft-dates">Preferred dates (YYYY-MM-DD, comma separated)</Label>
              <Input id="ft-dates" value={editDates} onChange={(e) => setEditDates(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="ft-times">Preferred times (comma separated)</Label>
              <Input id="ft-times" value={editTimes} onChange={(e) => setEditTimes(e.target.value)} placeholder="e.g. Morning, After 6pm" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="ft-notes">Notes for the coordinator</Label>
              <Textarea id="ft-notes" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={3} className="mt-1" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(null)}>Close</Button>
              <Button onClick={saveEdit} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save changes'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
};
