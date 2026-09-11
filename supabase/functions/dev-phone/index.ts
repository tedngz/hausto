// Backs /dev/phone, the fake WhatsApp thread.
//
// Admin-only, and it stays that way even though it is a dev tool: it reads
// renter phone numbers and message bodies, which is real personal data whatever
// the page it serves is called.
//
// It exists because `messages` and `renters` are RLS-closed to everything but
// admin SELECT, and simulating an inbound needs a write the SPA cannot make.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { SupabaseMessageStore, upsertRenterByPhone } from '../_shared/whatsapp/store.ts';
import { recordInbound } from '../_shared/whatsapp/send.ts';
import { toE164, isOptOut } from '../_shared/whatsapp/inbound.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'Unauthorized' }, 401);

  const asUser = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await asUser.auth.getUser(token);
  if (!userData?.user) return json({ error: 'Unauthorized' }, 401);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: isAdmin } = await db.rpc('has_role', { _user_id: userData.user.id, _role: 'admin' });
  if (isAdmin !== true) return json({ error: 'Forbidden' }, 403);

  let body: { action?: string; phone?: string; text?: string };
  try {
    body = req.method === 'POST' ? await req.json() : {};
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  // Who has a thread at all.
  if (body.action === 'renters') {
    const { data } = await db
      .from('renters')
      .select('id, phone_e164, display_name, service_window_expires_at, opted_out_at')
      .order('created_at', { ascending: false })
      .limit(50);
    return json({ renters: data ?? [] });
  }

  const phone = toE164(body.phone ?? '');
  if (!phone) return json({ error: 'invalid_phone' }, 400);

  if (body.action === 'thread') {
    const { data: renter } = await db
      .from('renters')
      .select('id, phone_e164, display_name, service_window_expires_at, opted_out_at')
      .eq('phone_e164', phone).maybeSingle();
    if (!renter) return json({ renter: null, messages: [] });

    const { data: messages } = await db
      .from('messages')
      .select('id, direction, body, template_name, status, created_at, sent_at, error, request_id')
      .eq('to_phone', phone)
      .order('created_at', { ascending: true })
      .limit(200);

    return json({
      renter,
      messages: messages ?? [],
      windowOpen: !!renter.service_window_expires_at &&
        new Date(renter.service_window_expires_at).getTime() > Date.now(),
    });
  }

  // Simulate an inbound. Goes through the same recordInbound the real webhook
  // uses, so the window and the dedupe behave identically - a mock that took a
  // shortcut here would be worth nothing as a rehearsal.
  if (body.action === 'inbound') {
    const text = String(body.text ?? '').trim();
    if (!text) return json({ error: 'empty_message' }, 400);

    const renter = await upsertRenterByPhone(db, phone);
    const store = new SupabaseMessageStore(db);
    const message = await recordInbound(store, {
      renterId: renter.id,
      body: text,
      providerMessageId: `dev-${crypto.randomUUID()}`,
    });

    if (isOptOut(text)) {
      await db.from('renters').update({ opted_out_at: new Date().toISOString() }).eq('id', renter.id);
    }
    return json({ success: true, messageId: message.id, optedOut: isOptOut(text) });
  }

  return json({ error: 'unknown_action' }, 400);
});
