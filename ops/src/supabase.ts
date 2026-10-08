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

export const SESSION_ENDED = 'Your sign-in ended - it was signed out elsewhere. Sign in again.';
const ENDED_KEY = 'hausto-ops-session-ended';

/** Forget this browser's dead session, so the shell shows sign-in with why. */
export function endSession(): void {
  try { sessionStorage.setItem(ENDED_KEY, '1'); } catch { /* the sign-in screen just will not say why */ }
  void supabase.auth.signOut({ scope: 'local' });
}

/** Read once by the sign-in screen. */
export function takeSessionEnded(): boolean {
  try {
    const ended = sessionStorage.getItem(ENDED_KEY) === '1';
    sessionStorage.removeItem(ENDED_KEY);
    return ended;
  } catch {
    return false;
  }
}

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
  // The functions check the session with the auth server, and a session ended
  // elsewhere fails there while its token still reads the tables. So a 401
  // here means sign in again, not "Unauthorized" on a screen that looks fine.
  if (context instanceof Response && context.status === 401) {
    endSession();
    return SESSION_ENDED;
  }
  const detail = context instanceof Response
    ? await context.clone().json().catch(() => null) as { error?: string; message?: string } | null
    : null;
  return detail?.message ?? detail?.error ?? payload?.message ?? payload?.error
    ?? (error as Error | null)?.message ?? fallback;
}
