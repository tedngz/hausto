import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { ViewingScheduleData } from '@/components/ViewingScheduleModal';

export interface FastTrackProperty {
  id: string;
  title: string;
  location: string;
  price: number;
  imageUrl?: string;
}

/**
 * Shared Fast-Track submission: inserts the fast_track_requests row and sends
 * the notification emails. Used by both HaustoChat (which additionally posts a
 * confirmation message into the thread) and MatchesView's "Schedule viewing" CTA.
 */
export const useFastTrackRequest = () => {
  const { user } = useAuth();

  const submitFastTrack = async ({
    conversationId,
    realtorId,
    scheduleData,
    properties,
  }: {
    conversationId: string;
    realtorId: string;
    scheduleData: ViewingScheduleData;
    /** Full property info for the email; filtered to selectedPropertyIds internally. */
    properties: FastTrackProperty[];
  }): Promise<void> => {
    if (!user?.id) throw new Error('User not authenticated');

    const { error: requestError } = await supabase.from('fast_track_requests').insert({
      conversation_id: conversationId,
      renter_id: user.id,
      realtor_id: realtorId,
      property_ids: scheduleData.selectedPropertyIds,
      preferred_dates: scheduleData.dates.map(d => format(d, 'yyyy-MM-dd')),
      preferred_times: scheduleData.preferredTimes,
      special_requirements: scheduleData.specialRequirements || null,
      status: 'pending',
    });
    if (requestError) throw requestError;

    // Notification emails are best-effort: the request row is the source of truth.
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('name, email')
        .eq('id', user.id)
        .single();

      const selected = properties.filter(p => scheduleData.selectedPropertyIds.includes(p.id));

      await supabase.functions.invoke('notify-fast-track-request', {
        body: {
          renterName: profile?.name || 'User',
          renterEmail: profile?.email || user.email || '',
          preferredDates: scheduleData.dates.map(d => format(d, 'MMM dd, yyyy')),
          preferredTimes: scheduleData.preferredTimes,
          specialRequirements: scheduleData.specialRequirements || '',
          properties: selected.map(p => ({
            id: p.id,
            title: p.title,
            location: p.location,
            price: p.price,
            imageUrl: p.imageUrl || '',
          })),
          conversationId,
        },
      });
    } catch (notificationError) {
      console.error('Error sending fast track notification:', notificationError);
    }
  };

  return { submitFastTrack };
};
