import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useViewingQuota } from '@/hooks/useViewingQuota';
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
 * the notification emails. Used by the "Schedule viewing" CTAs in MatchesView,
 * BrowseTable and the listing page.
 */
export const useFastTrackRequest = () => {
  const { user } = useAuth();
  const { quota, refetchQuota } = useViewingQuota();

  const submitFastTrack = async ({
    conversationId,
    realtorId,
    scheduleData,
    properties,
  }: {
    /** Null since the chat was retired - the row stands on its own. */
    conversationId?: string | null;
    realtorId?: string | null;
    scheduleData: ViewingScheduleData;
    /** Full property info for the email; filtered to selectedPropertyIds internally. */
    properties: FastTrackProperty[];
  }): Promise<void> => {
    if (!user?.id) throw new Error('User not authenticated');

    // Free tier gets one trial coordination, premium 3 per cycle; the $20
    // add-on lifts the cap. Each listing in the request costs one, so a
    // multi-listing booking needs that many left. Callers catch this error to
    // show the upsell.
    if (quota && quota.remaining < Math.max(1, scheduleData.selectedPropertyIds.length)) {
      throw new Error('VIEWING_QUOTA_EXCEEDED');
    }

    const { error: requestError } = await supabase.from('fast_track_requests').insert({
      conversation_id: conversationId ?? null,
      renter_id: user.id,
      realtor_id: realtorId ?? null,
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

    refetchQuota();
  };

  return { submitFastTrack };
};
