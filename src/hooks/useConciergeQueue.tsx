import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface ConciergeEscalation {
  id: string;
  conversation_id: string;
  renter_id: string;
  realtor_id: string;
  property_id: string | null;
  question: string;
  status: 'pending' | 'answered' | 'dismissed';
  created_at: string;
  renter_name?: string;
  property_title?: string;
}

export interface FastTrackQueueItem {
  id: string;
  conversation_id: string;
  renter_id: string;
  property_ids: string[];
  preferred_dates: string[];
  preferred_times: string[];
  special_requirements: string | null;
  status: 'pending' | 'in_progress' | 'scheduled' | 'completed' | 'cancelled';
  created_at: string;
  renter_name?: string;
  property_titles?: string[];
}

/**
 * Realtor-side concierge queue: escalated renter questions the AI couldn't
 * answer, plus Fast-Track viewing requests with editable status.
 */
export const useConciergeQueue = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: escalations = [], isLoading: isLoadingEscalations } = useQuery({
    queryKey: ['concierge-queue-escalations', user?.id],
    queryFn: async (): Promise<ConciergeEscalation[]> => {
      const { data, error } = await supabase
        .from('concierge_escalations')
        .select('*')
        .eq('realtor_id', user!.id)
        .neq('status', 'dismissed')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return enrichRows(data || []);
    },
    enabled: !!user?.id,
    refetchInterval: 15000,
  });

  const { data: fastTrackRequests = [], isLoading: isLoadingFastTrack } = useQuery({
    queryKey: ['concierge-queue-fast-track', user?.id],
    queryFn: async (): Promise<FastTrackQueueItem[]> => {
      const { data, error } = await supabase
        .from('fast_track_requests')
        .select('*')
        .eq('realtor_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      const rows = (data || []) as unknown as FastTrackQueueItem[];
      // Enrich with renter names and property titles
      const renterIds = [...new Set(rows.map(r => r.renter_id))];
      const propertyIds = [...new Set(rows.flatMap(r => r.property_ids || []))];
      const [profiles, titles] = await Promise.all([
        fetchProfiles(renterIds),
        fetchPropertyTitles(propertyIds),
      ]);
      return rows.map(r => ({
        ...r,
        renter_name: profiles.get(r.renter_id),
        property_titles: (r.property_ids || []).map(id => titles.get(id) || 'Unknown property'),
      }));
    },
    enabled: !!user?.id,
    refetchInterval: 30000,
  });

  // Enrich escalations with renter name + property title
  const enrichRows = async (rows: ConciergeEscalation[]): Promise<ConciergeEscalation[]> => {
    const renterIds = [...new Set(rows.map(r => r.renter_id))];
    const propertyIds = [...new Set(rows.map(r => r.property_id).filter(Boolean))] as string[];
    const [profiles, titles] = await Promise.all([
      fetchProfiles(renterIds),
      fetchPropertyTitles(propertyIds),
    ]);
    return rows.map(r => ({
      ...r,
      renter_name: profiles.get(r.renter_id),
      property_title: r.property_id ? titles.get(r.property_id) : undefined,
    }));
  };

  const fetchProfiles = async (userIds: string[]): Promise<Map<string, string>> => {
    if (userIds.length === 0) return new Map();
    const { data } = await supabase.rpc('get_matched_public_profiles', { user_ids: userIds });
    return new Map((data || []).map((p: { id: string; name: string }) => [p.id, p.name]));
  };

  const fetchPropertyTitles = async (ids: string[]): Promise<Map<string, string>> => {
    if (ids.length === 0) return new Map();
    const [internal, external] = await Promise.all([
      supabase.from('properties').select('id, title').in('id', ids),
      supabase.from('external_properties').select('id, title').in('id', ids),
    ]);
    const map = new Map<string, string>();
    (internal.data || []).forEach(p => map.set(p.id, p.title));
    (external.data || []).forEach(p => map.set(p.id, p.title));
    return map;
  };

  // The renter has no in-app thread any more, so the answer goes out by email.
  // concierge-answer owns delivery and flips the escalation to answered.
  const answerEscalationMutation = useMutation({
    mutationFn: async ({ escalation, replyText }: { escalation: ConciergeEscalation; replyText: string }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const { data, error } = await supabase.functions.invoke('concierge-answer', {
        body: { escalationId: escalation.id, reply: replyText },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { emailDelivered?: boolean };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['concierge-queue-escalations'] });
      toast.success(data?.emailDelivered
        ? 'Reply emailed to the renter.'
        : 'Marked as answered, but the email could not be sent.');
    },
    onError: (error) => {
      console.error('Error answering escalation:', error);
      toast.error('Failed to send reply. Please try again.');
    },
  });

  const dismissEscalationMutation = useMutation({
    mutationFn: async (escalationId: string) => {
      const { error } = await supabase
        .from('concierge_escalations')
        .update({ status: 'dismissed' })
        .eq('id', escalationId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['concierge-queue-escalations'] });
    },
  });

  const updateFastTrackStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: FastTrackQueueItem['status'] }) => {
      const { error } = await supabase
        .from('fast_track_requests')
        .update({ status })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['concierge-queue-fast-track'] });
      toast.success('Viewing request status updated.');
    },
    onError: (error) => {
      console.error('Error updating fast track status:', error);
      toast.error('Failed to update status. Please try again.');
    },
  });

  const pendingCount =
    escalations.filter(e => e.status === 'pending').length +
    fastTrackRequests.filter(r => r.status === 'pending').length;

  return {
    escalations,
    fastTrackRequests,
    pendingCount,
    isLoading: isLoadingEscalations || isLoadingFastTrack,
    answerEscalation: (escalation: ConciergeEscalation, replyText: string) =>
      answerEscalationMutation.mutateAsync({ escalation, replyText }),
    isAnswering: answerEscalationMutation.isPending,
    dismissEscalation: (id: string) => dismissEscalationMutation.mutate(id),
    updateFastTrackStatus: (id: string, status: FastTrackQueueItem['status']) =>
      updateFastTrackStatusMutation.mutate({ id, status }),
  };
};
