import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, UserCheck, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

type Status = 'pending' | 'approved' | 'rejected';

interface ApplicationRow {
  id: string;
  user_id: string;
  full_name: string;
  company: string | null;
  phone: string;
  email: string;
  role_type: string;
  city: string;
  districts: string[];
  years_experience: number;
  properties_count: number;
  website_or_listing_url: string | null;
  bio: string;
  status: Status;
  admin_notes: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export const RealtorApplicationsPanel = () => {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Status>('pending');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['realtor-applications', tab],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('realtor_applications')
        .select('*')
        .eq('status', tab)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as ApplicationRow[];
    },
  });

  const review = async (app: ApplicationRow, status: 'approved' | 'rejected') => {
    setBusyId(app.id);
    const { error } = await supabase
      .from('realtor_applications')
      .update({ status, admin_notes: notes[app.id] ?? app.admin_notes ?? null })
      .eq('id', app.id);
    setBusyId(null);
    if (error) {
      toast.error('Update failed', { description: error.message });
      return;
    }
    toast.success(status === 'approved' ? 'Realtor approved' : 'Application rejected');
    qc.invalidateQueries({ queryKey: ['realtor-applications'] });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserCheck className="h-5 w-5" />
          Realtor Applications
        </CardTitle>
        <CardDescription>
          Review applications. Approving instantly grants the realtor role and dashboard access.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={(v) => setTab(v as Status)}>
          <TabsList>
            <TabsTrigger value="pending">Pending</TabsTrigger>
            <TabsTrigger value="approved">Approved</TabsTrigger>
            <TabsTrigger value="rejected">Rejected</TabsTrigger>
          </TabsList>

          <TabsContent value={tab} className="mt-4 space-y-4">
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : !data?.length ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No {tab} applications.
              </p>
            ) : (
              data.map((app) => (
                <div key={app.id} className="rounded-lg border p-4 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {app.full_name}{' '}
                        <span className="text-muted-foreground font-normal">· {app.email}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {app.role_type} · {app.city} ·{' '}
                        {new Date(app.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {app.company && <Badge variant="outline">{app.company}</Badge>}
                      <Badge variant="outline">{app.years_experience}y exp</Badge>
                      <Badge variant="outline">{app.properties_count} listings</Badge>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs uppercase text-muted-foreground mb-1">Phone</p>
                      <p>{app.phone}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground mb-1">Districts</p>
                      <p>{app.districts?.join(', ') || '—'}</p>
                    </div>
                    {app.website_or_listing_url && (
                      <div className="md:col-span-2">
                        <p className="text-xs uppercase text-muted-foreground mb-1">Website</p>
                        <a
                          href={app.website_or_listing_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary inline-flex items-center gap-1 hover:underline break-all"
                        >
                          {app.website_or_listing_url} <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    )}
                    <div className="md:col-span-2">
                      <p className="text-xs uppercase text-muted-foreground mb-1">Bio</p>
                      <p className="whitespace-pre-wrap text-muted-foreground">{app.bio}</p>
                    </div>
                  </div>

                  {tab === 'pending' && (
                    <>
                      <Textarea
                        rows={2}
                        placeholder="Internal notes (optional, shown to applicant if rejected)"
                        value={notes[app.id] ?? ''}
                        onChange={(e) =>
                          setNotes((n) => ({ ...n, [app.id]: e.target.value }))
                        }
                      />
                      <div className="flex gap-2 justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busyId === app.id}
                          onClick={() => review(app, 'rejected')}
                        >
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          disabled={busyId === app.id}
                          onClick={() => review(app, 'approved')}
                        >
                          {busyId === app.id && (
                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                          )}
                          Approve
                        </Button>
                      </div>
                    </>
                  )}

                  {tab !== 'pending' && app.admin_notes && (
                    <div className="rounded-md bg-muted/40 p-2 text-xs">
                      <span className="font-medium">Notes:</span> {app.admin_notes}
                    </div>
                  )}
                </div>
              ))
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};
