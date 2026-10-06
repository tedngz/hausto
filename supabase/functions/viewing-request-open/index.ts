// What the request modal needs to know before the renter picks anything.
//
//   open      - the request a new place would join, if any. The modal says
//               "adding to HV-4KX2" and shows its times, rather than asking
//               for times the join would not use.
//   blocking  - the request a new one would wait behind (one request being
//               worked at a time, SPEC §1). Often the same request; a full one,
//               or one whose plan has gone out, blocks without being joinable.
//   passRequired - two plans lapsed without being locked in, and no Pass.
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
import { hasPassCover } from '../_shared/viewing/lock-in-run.ts';

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
    const [{ joinable, blocking }, lapsed, hasPass] = await Promise.all([
      findOpenRequests(db, user.id, hcmcDate(new Date())),
      countLapsedPlans(db, user.id),
      hasPassCover(db, user.id),
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
    });
  } catch (e) {
    console.error('[viewing-request-open]', e);
    // The modal falls back to asking for times; the server decides at submit.
    return json({ open: null, blocking: null, passRequired: false, error: 'lookup_failed' }, 500);
  }
});
