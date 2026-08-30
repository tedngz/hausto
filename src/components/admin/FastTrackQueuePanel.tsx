import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CalendarCheck } from 'lucide-react';
import { ViewingRequestsManager } from '@/components/ViewingRequestsManager';

// Admin ops queue for Fast-Track viewing requests. Shares the grouped-by-renter
// manager with the realtor dashboard; admin scope adds agent phone numbers and
// the listing availability write-back (confirmed live / rented).
export const FastTrackQueuePanel = () => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <CalendarCheck className="w-5 h-5" />
        Viewing coordination queue
      </CardTitle>
      <CardDescription>
        Confirm schedules, suggest changes, or cancel - the renter is notified in
        chat and by email. Availability findings write back to the listings.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <ViewingRequestsManager scope="admin" />
    </CardContent>
  </Card>
);
