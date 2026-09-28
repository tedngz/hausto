// Create a concierge availability request (SPEC §11). The complex page's
// "Request availability" form posts here.
//
// Writes the request and a PENDING watch with the same criteria, and hands
// back a wa.me link carrying the watch's code. Nothing is sent, and the
// concierge is not told, until the renter sends that code from their own
// phone - so there is no phone number in this request at all, and a caller
// cannot point our messages at somebody else.
//
// WhatsApp only. Email requests are retired; the old ones keep their threads.
//
// Signed-in is optional, as it always was for this form. A request spends no
// viewing credit: it asks a person to check a building, and viewings are
// requested, and paid for, from the listings they send back.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { clientIp, identifyCaller, isRateLimited } from '../_shared/rate-limit.ts';
import { generateWatchCode, watchExpiry } from '../_shared/viewing/watch.ts';
import { buildInquiryLink, validateInquiryInput } from '../_shared/viewing/inquiry.ts';

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

  const now = new Date();
  const input = validateInquiryInput(body, now);
  if (!input.ok) return json({ error: 'invalid_request', message: input.error }, 400);
  const v = input.value;

  const db = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: complex } = await db
    .from('complexes').select('id, name, is_published').eq('id', v.complexId).maybeSingle();
  if (!complex || complex.is_published === false) return json({ error: 'invalid_complex', message: 'Unknown building.' }, 404);

  const caller = await identifyCaller(req, createClient(SUPABASE_URL, ANON_KEY));

  // ── The handshake ─────────────────────────────────────────────────────────
  const expiresAt = watchExpiry(now, v.moveInDate).toISOString();
  let watch: { id: string; code: string } | null = null;
  for (let attempt = 0; attempt < 5 && !watch; attempt++) {
    const code = generateWatchCode();
    const { data, error } = await db.from('complex_watches').insert({
      complex_id: complex.id,
      code,
      user_id: caller.userId,
      bedrooms: v.bedrooms,
      budget_max_vnd: v.budgetMaxVnd,
      move_in_by: v.moveInDate,
      expires_at: expiresAt,
    }).select('id').single();
    if (!error && data) { watch = { id: data.id, code }; break; }
    if (error?.code !== '23505') {
      console.error('[complex-inquiry-create] watch insert failed:', error);
      return json({ error: 'create_failed' }, 500);
    }
  }
  if (!watch) return json({ error: 'code_collision' }, 500);

  // ── The request ───────────────────────────────────────────────────────────
  const { data: inquiry, error: inqErr } = await db.from('complex_inquiries').insert({
    complex_id: complex.id,
    user_id: caller.userId,
    full_name: v.name,
    target_move_in_date: v.moveInDate,
    lease_duration_months: v.leaseMonths,
    bedrooms_needed: v.bedrooms,
    budget_max_vnd: v.budgetMaxVnd,
    has_pets: v.hasPets,
    additional_notes: v.notes,
    channel: 'WHATSAPP',
    watch_id: watch.id,
  }).select('id').single();
  if (inqErr || !inquiry) {
    console.error('[complex-inquiry-create] inquiry insert failed:', inqErr);
    await db.from('complex_watches').delete().eq('id', watch.id);
    return json({ error: 'create_failed' }, 500);
  }

  return json({
    success: true,
    inquiryId: inquiry.id,
    complexName: complex.name,
    code: watch.code,
    waLink: buildInquiryLink(BUSINESS_PHONE, watch.code, complex.name),
    alertsUntil: expiresAt,
  });
});
