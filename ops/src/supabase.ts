// The ops console's own Supabase client.
//
// Separate from the renter SPA's, and pointedly not importing it: that client
// brokers a preview auth storage and persists a renter session, and an operator
// signed in on the same browser must not end up sharing one. Different auth
// surface means a different client, not the same client with a different route.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://gbgrwjdmytaksrztcyzs.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdiZ3J3amRteXRha3NyenRjeXpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIwNDQwNDcsImV4cCI6MjA2NzYyMDA0N30.pJnXggzvzGxHrOaF_ygThG7Ws66Y4VFH102iQtPS118';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // Its own storage key, so signing in here does not sign a renter out there
    // and vice versa.
    storageKey: 'hausto-ops-auth',
    persistSession: true,
    autoRefreshToken: true,
  },
});
