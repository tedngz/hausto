// Inbound WhatsApp. Meta calls this, so it cannot present a Supabase JWT -
// supabase/config.toml sets verify_jwt = false and the signature is what
// authenticates the caller instead.
//
// Verify the signature, parse the batch, and hand each message to
// `handleInbound` - which re-opens the service window, stores the row, logs the
// reply and honours an opt-out, in that order. The order matters: the window is
// the fact with a deadline attached. A message we failed to store can be
// recovered from Meta; a window we failed to extend silently blocks every reply
// for 24 hours.
//
// `handleInbound` is shared with `dev-phone` so the mock inbound path and the
// real one cannot drift apart.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { SupabaseMessageStore } from '../_shared/whatsapp/store.ts';
import {
  verifyMetaSignature,
  parseInboundMessages,
  verifySubscription,
} from '../_shared/whatsapp/inbound.ts';
import { handleInbound } from '../_shared/viewing/routing.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP_SECRET = Deno.env.get('WHATSAPP_APP_SECRET') || '';
const VERIFY_TOKEN = Deno.env.get('WHATSAPP_VERIFY_TOKEN') || '';

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Meta's one-time subscription handshake. Plain text, challenge echoed back.
  if (req.method === 'GET') {
    const result = verifySubscription(url, VERIFY_TOKEN);
    if (!result.ok) return new Response('Forbidden', { status: 403 });
    return new Response(result.challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // The RAW body, read once and never re-serialised. The signature is over
  // bytes, and JSON.parse/stringify reorders keys and drops whitespace - which
  // is how this turns into an unexplained "bad signature" nobody can reproduce.
  const rawBody = await req.text();

  if (!await verifyMetaSignature(rawBody, req.headers.get('x-hub-signature-256'), APP_SECRET)) {
    // Deliberately terse. An unsigned caller learns nothing about why.
    console.warn('[whatsapp-webhook] signature verification failed');
    return new Response('Forbidden', { status: 403 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // 200 on purpose: a body we cannot parse will not parse on retry either,
    // and Meta retries a non-2xx for days.
    console.warn('[whatsapp-webhook] unparseable body');
    return new Response('ok', { status: 200 });
  }

  const messages = parseInboundMessages(payload);
  if (messages.length === 0) {
    // Status callbacks (delivered/read) land here. Nothing to do yet.
    return new Response('ok', { status: 200 });
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE);
  const store = new SupabaseMessageStore(db);

  for (const m of messages) {
    try {
      // Window, row, event, opt-out - all of it in one place, shared with the
      // mock inbound path so the two cannot drift.
      const { renterId, optedOut } = await handleInbound(db, store, m);
      if (optedOut) console.log(`[whatsapp-webhook] ${renterId} opted out`);
    } catch (e) {
      // One bad message must not cost us the rest of the batch, and must not
      // make Meta retry the whole delivery - the others are already stored.
      console.error(`[whatsapp-webhook] failed on ${m.providerMessageId}:`, e);
    }
  }

  // Always 200 once the signature checked out. Meta retries aggressively on
  // anything else, and a retry cannot fix a problem on our side.
  return new Response('ok', { status: 200 });
});
