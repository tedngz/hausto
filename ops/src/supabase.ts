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

/**
 * Why an edge-function call failed, as the sentence the function wrote for the
 * operator, or null if it did not fail. On a non-2xx supabase-js leaves `data`
 * null and puts the response behind `error.context`, so reading `data` alone
 * showed "Edge Function returned a non-2xx status code" in place of the reason.
 */
export async function invokeFailure(data: unknown, error: unknown, fallback = 'Failed'): Promise<string | null> {
  const payload = data as { error?: string; message?: string } | null;
  if (!error && !payload?.error) return null;
  const context = (error as { context?: unknown } | null)?.context;
  const detail = context instanceof Response
    ? await context.clone().json().catch(() => null) as { error?: string; message?: string } | null
    : null;
  return detail?.message ?? detail?.error ?? payload?.message ?? payload?.error
    ?? (error as Error | null)?.message ?? fallback;
}
