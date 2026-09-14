// The back end for /dev/phone: a fake WhatsApp thread (SPEC §5).
//
// Two operations, both on POST so the SPA can use `functions.invoke` without
// hand-rolling a signed GET: a body of `{phone}` reads the thread, and
// `{phone, text}` simulates an inbound message from it. Between them, every milestone through S6 is demoable
// without Meta Business verification, a provisioned number, or an approved
// template - which is the point, since all three are human-blocked and none
// will be done when this ships.
//
// **It refuses to run in cloud mode.** An unauthenticated endpoint that
// fabricates inbound messages is a forgery tool the moment the number is real:
// it would re-open service windows and write RENTER_REPLIED events on behalf of
// people who said nothing. Mock mode only, checked before anything else.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { SupabaseMessageStore } from '../_shared/whatsapp/store.ts';
import { handleInbound } from '../_shared/viewing/routing.ts';
import { toE164 } from '../_shared/whatsapp/inbound.ts';
import { clientIp, isRateLimited } from '../_shared/rate-limit.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WHATSAPP_MODE = Deno.env.get('WHATSAPP_MODE') || 'mock';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  if (WHATSAPP_MODE === 'cloud') {
    return json({
      error: 'disabled_in_cloud_mode',
      message: 'dev-phone simulates inbound messages and is mock-only. See the note at the top of the function.',
    }, 403);
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE);

  if (req.method === 'GET') {
    const phone = toE164(new URL(req.url).searchParams.get('phone') ?? '');
    if (!phone) return json({ error: 'invalid_phone' }, 400);
    return json(await readThread(db, phone));
  }

  if (req.method !== 'POST') return json({ error: 'Use GET or POST' }, 405);

  if (await isRateLimited(`dev-phone:${clientIp(req)}`, 60, 3600)) {
    return json({ error: 'rate_limited' }, 429);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const phone = toE164(String(body.phone ?? ''));
  if (!phone) return json({ error: 'invalid_phone' }, 400);
  // No text is a read, not a mistake: it is how the page polls the thread.
  const text = String(body.text ?? '').trim();
  if (!text) return json(await readThread(db, phone));

  // The same path Meta's delivery takes, down to the provider id shape. A
  // simulated message that skipped the window update or the event would make
  // /dev/phone a demo of something we have not built.
  const store = new SupabaseMessageStore(db);
  const outcome = await handleInbound(db, store, {
    from: phone,
    text,
    providerMessageId: `mock-in-${crypto.randomUUID()}`,
    timestamp: new Date().toISOString(),
  });

  return json({ success: true, ...outcome, thread: await readThread(db, phone) });
});

/**
 * The thread, plus the two facts that explain why a send would be refused.
 *
 * `/dev/phone` shows both: a closed window and a 2-in-a-row count are the
 * states the sending rules exist for, and a mock phone that hid them would let
 * you demo a flow that throws in production.
 */
// deno-lint-ignore no-explicit-any
async function readThread(db: any, phone: string) {
  const { data: renter } = await db
    .from('renters')
    .select('id, phone_e164, display_name, service_window_expires_at, opted_out_at')
    .eq('phone_e164', phone)
    .maybeSingle();

  const { data: messages } = await db
    .from('messages')
    .select('id, request_id, direction, body, template_name, status, error, created_at, sent_at')
    .eq('to_phone', phone)
    .order('created_at', { ascending: true })
    .limit(200);

  let consecutiveOutbound = 0;
  for (const m of [...(messages ?? [])].reverse()) {
    if (m.direction === 'IN') break;
    consecutiveOutbound++;
  }

  const windowOpen = !!renter?.service_window_expires_at &&
    new Date(renter.service_window_expires_at).getTime() > Date.now();

  return { renter: renter ?? null, messages: messages ?? [], windowOpen, consecutiveOutbound, mode: WHATSAPP_MODE };
}
