// Create a complex watch (SPEC §11). The complex page's "Get WhatsApp alerts".
//
// Writes a PENDING watch and hands back a wa.me link carrying its code. Nothing
// is ever sent to a watch until the renter sends that code from their own
// phone - so there is no phone number in this request at all, and a caller
// cannot point alerts at somebody else.
//
// Signed-in is optional. A watch spends nothing, and the code is the proof of
// ownership that matters; the account, when there is one, is linked to the
// renter row when the code arrives.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { clientIp, identifyCaller, isRateLimited } from '../_shared/rate-limit.ts';
import { buildWatchLink, generateWatchCode, validateWatchInput, watchExpiry } from '../_shared/viewing/watch.ts';

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

  if (await isRateLimited(`complex-watch:${clientIp(req)}`, 10, 3600)) {
    return json({ error: 'rate_limited', message: 'Too many alerts set up from here. Try again in an hour.' }, 429);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const now = new Date();
  const criteria = validateWatchInput(body, now);
  if (!criteria.ok) return json({ error: 'invalid_criteria', message: criteria.error }, 400);

  const complexId = String(body.complexId ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(complexId)) return json({ error: 'invalid_complex' }, 400);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: complex } = await db
    .from('complexes').select('id, name, is_published').eq('id', complexId).maybeSingle();
  if (!complex || complex.is_published === false) return json({ error: 'invalid_complex' }, 404);

  // Anonymous is fine; a signed-in caller gets their account linked later.
  const caller = await identifyCaller(req, createClient(SUPABASE_URL, ANON_KEY));

  const expiresAt = watchExpiry(now, criteria.value.moveInBy).toISOString();
  let code: string | null = null;
  for (let attempt = 0; attempt < 5 && !code; attempt++) {
    const candidate = generateWatchCode();
    const { error } = await db.from('complex_watches').insert({
      complex_id: complex.id,
      code: candidate,
      user_id: caller.userId,
      bedrooms: criteria.value.bedrooms,
      budget_max_vnd: criteria.value.budgetMaxVnd,
      move_in_by: criteria.value.moveInBy,
      expires_at: expiresAt,
    });
    if (!error) { code = candidate; break; }
    if (error.code !== '23505') {
      console.error('[complex-watch-create] insert failed:', error);
      return json({ error: 'create_failed' }, 500);
    }
  }
  if (!code) return json({ error: 'code_collision' }, 500);

  return json({
    success: true,
    code,
    complexName: complex.name,
    waLink: buildWatchLink(BUSINESS_PHONE, code, complex.name),
    expiresAt,
  });
});
