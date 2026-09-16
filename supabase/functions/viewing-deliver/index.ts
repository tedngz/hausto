// Assemble the itinerary and send it, on an operator's say-so.
//
// Auth and HTTP only. Everything about what gets said and in what order lives
// in `_shared/viewing/deliver.ts`, shared with the job runner so the two
// cannot drift - and so neither has to call the other over HTTP.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { adapterFromEnv } from '../_shared/whatsapp/adapter.ts';
import { deliver, DELIVERY_PURPOSES, type DeliveryPurpose } from '../_shared/viewing/deliver.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const STATUS: Record<string, number> = {
  unknown_request: 404,
  service_window_closed: 409,
  too_many_consecutive: 429,
  send_failed: 500,
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE);

  // An operator or the service role. Delivery costs money and spends the
  // renter's attention; it is not an open endpoint.
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  let actor = 'SYSTEM';
  if (token !== SERVICE_ROLE) {
    const { data: userData } = await db.auth.getUser(token);
    const userId = userData?.user?.id;
    if (!userId) return json({ error: 'Unauthorized' }, 401);
    const { data: role } = await db
      .from('user_roles').select('role').eq('user_id', userId).eq('role', 'ops').maybeSingle();
    if (!role) return json({ error: 'Forbidden' }, 403);
    actor = `OPS:${userId}`;
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const requestId = String(body.requestId ?? '');
  if (!requestId) return json({ error: 'requestId is required' }, 400);

  // Checked, not cast. `as DeliveryPurpose` on an HTTP body is a lie the
  // compiler believes: deliver() falls through to a holding update for
  // anything it does not recognise, so a typo'd purpose used to send a renter
  // a plausible, wrong message instead of failing. Found by rehearsing it.
  const purpose = String(body.purpose ?? 'ITINERARY');
  if (!DELIVERY_PURPOSES.includes(purpose as DeliveryPurpose)) {
    return json({ error: `unknown purpose '${purpose}'`, allowed: DELIVERY_PURPOSES }, 400);
  }

  let adapter;
  try { adapter = adapterFromEnv(Deno.env.toObject()); }
  catch (e) { return json({ error: (e as Error).message }, 500); }

  const result = await deliver(db, adapter, {
    requestId,
    purpose: purpose as DeliveryPurpose,
    order: Array.isArray(body.order) ? body.order.map(String) : undefined,
    substitutes: Array.isArray(body.substitutes)
      ? body.substitutes as { title: string; priceVnd: number; districtCode: string | null }[]
      : undefined,
    attempt: Number(body.attempt ?? 1),
    actor,
  });

  if (!result.ok) {
    return json({ error: result.code, message: result.message, preview: result.preview }, STATUS[result.code] ?? 500);
  }
  return json({ success: true, ...result });
});
