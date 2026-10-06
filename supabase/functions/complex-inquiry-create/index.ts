// Create a concierge availability request (SPEC §11). The complex page's
// "Request availability" form posts here, and so does Search for me.
//
// The rules - a building for anyone, an area for a signed-in Pass holder with
// no other search open, and the 48 hours an area is promised - are
// `_shared/viewing/inquiry-create.ts`, tested. This is the door: the rate
// limit, the body, and who is calling.
//
// WhatsApp only. Email requests are retired; the old ones keep their threads.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { clientIp, identifyCaller, isRateLimited } from '../_shared/rate-limit.ts';
import { createInquiry } from '../_shared/viewing/inquiry-create.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
// Same fallback as viewing-request-create: the flow stays demoable on mock
// without a provisioned number.
const BUSINESS_PHONE = Deno.env.get('WHATSAPP_BUSINESS_PHONE') || '+84000000000';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  if (await isRateLimited(`complex-inquiry:${clientIp(req)}`, 10, 3600)) {
    return json({ error: 'rate_limited', message: 'Too many requests from here. Try again in an hour.' }, 429);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE);
  const caller = await identifyCaller(req, createClient(SUPABASE_URL, ANON_KEY));
  const result = await createInquiry(db, body, { userId: caller.userId, now: new Date(), businessPhone: BUSINESS_PHONE });
  return json(result.body, result.status);
});
