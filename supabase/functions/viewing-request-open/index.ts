// What the request modal needs to know before the renter picks anything.
//
//   open      - the request a new place would join, if any. The modal says
//               "adding to HV-4KX2" and shows its times, rather than asking
//               for times the join would not use.
//   blocking  - the request a new one would wait behind (one request being
//               worked at a time, SPEC §1). Often the same request; a full one,
//               or one whose plan has gone out, blocks without being joinable.
//   passRequired - two plans lapsed without being locked in, and no Pass.
//   lapsedPlans, freeViewingAvailable - with hasPass, what requestGate needs
//               that the modal cannot know; it adds the places it was opened
//               for and whether it is joining (SPEC §9).
//
// `viewing-request-create` decides all of it again at submit - this is a
// preview, not a promise.
//
// Returns only what the renter already knows about their own request: its
// ref, the windows they gave, and which listings are in it. No state (a
// half-reduced status in the browser is worse than none - see
// ViewingRequestsPane), nothing about agents or outcomes.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { clientIp, isRateLimited } from '../_shared/rate-limit.ts';
import { hcmcDate, MAX_LAPSED_WITHOUT_PASS } from '../_shared/viewing/intake.ts';
import { countLapsedPlans, findOpenRequests } from '../_shared/viewing/open-request.ts';
import { freeViewingAvailable, hasPassCover } from '../_shared/viewing/lock-in-run.ts';

type Db = ReturnType<typeof createClient>;

/**
 * Whether the free viewing is still there for this account: true if any of
 * its WhatsApp numbers has not had it, null if it has no number yet (a first
 * request). Submit decides again with the number the renter gives.
 */
async function accountFreeViewing(db: Db, userId: string): Promise<boolean | null> {
  const { data } = await db.from('renters').select('phone_e164').eq('user_id', userId);
  const numbers = (data ?? []).map((r: { phone_e164: string }) => r.phone_e164).filter(Boolean);
  if (numbers.length === 0) return null;
  const unspent = await Promise.all(numbers.map((n: string) => freeViewingAvailable(db, n)));
  return unspent.some(Boolean);
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST' && req.method !== 'GET') return json({ error: 'Use POST' }, 405);

  // Called once per modal open. Looser than intake's limit, since it writes
  // nothing and costs nobody anything.
  if (await isRateLimited(`viewing-open:${clientIp(req)}`, 120, 3600)) {
    return json({ error: 'rate_limited' }, 429);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const { data: authData } = jwt
    ? await createClient(SUPABASE_URL, ANON_KEY).auth.getUser(jwt)
    : { data: null };
  const user = authData?.user;
  if (!user) return json({ error: 'sign_in_required' }, 401);

  try {
    const db = createClient(SUPABASE_URL, SERVICE_ROLE);
    const [{ joinable, blocking }, lapsed, hasPass, freeViewing] = await Promise.all([
      findOpenRequests(db, user.id, hcmcDate(new Date())),
      countLapsedPlans(db, user.id),
      hasPassCover(db, user.id),
      accountFreeViewing(db, user.id),
    ]);
    return json({
      open: joinable
        ? {
          ref: joinable.ref,
          availability: joinable.availability,
          listingIds: joinable.listingIds,
        }
        : null,
      blocking: blocking ? { ref: blocking.ref, listingIds: blocking.listingIds } : null,
      passRequired: lapsed >= MAX_LAPSED_WITHOUT_PASS && !hasPass,
      hasPass,
      // The inputs to requestGate the modal cannot know, so it can apply the
      // same rule with the places it was opened for.
      lapsedPlans: lapsed,
      freeViewingAvailable: freeViewing,
    });
  } catch (e) {
    console.error('[viewing-request-open]', e);
    // The modal falls back to asking for times; the server decides at submit.
    return json({ open: null, blocking: null, passRequired: false, error: 'lookup_failed' }, 500);
  }
});
