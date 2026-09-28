// The signed-in renter's request that a new place would join, if any.
//
// The modal asks this when it opens, so it can say "adding to HV-4KX2" and
// show that request's times before the renter commits, instead of asking for
// times the join would not use. `viewing-request-create` decides again at
// submit - this is a preview, not a promise.
//
// Returns only what the renter already knows about their own request: its
// ref, the windows they gave, and which listings are in it. No state (a
// half-reduced status in the browser is worse than none - see
// ViewingRequestsPane), nothing about agents or outcomes.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { clientIp, isRateLimited } from '../_shared/rate-limit.ts';
import { hcmcDate } from '../_shared/viewing/intake.ts';
import { findJoinableRequest } from '../_shared/viewing/open-request.ts';

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
    const open = await findJoinableRequest(
      createClient(SUPABASE_URL, SERVICE_ROLE), user.id, hcmcDate(new Date()),
    );
    return json({
      open: open
        ? {
          ref: open.ref,
          availability: open.availability,
          listingIds: open.listingIds,
        }
        : null,
    });
  } catch (e) {
    console.error('[viewing-request-open]', e);
    // The modal falls back to asking for times, which is always safe.
    return json({ open: null, error: 'lookup_failed' }, 500);
  }
});
