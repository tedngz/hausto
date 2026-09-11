// Inbound WhatsApp. Meta calls this, so it cannot present a Supabase JWT -
// supabase/config.toml sets verify_jwt = false and the signature is what
// authenticates the caller instead.
//
// Two jobs, and it does them in this order deliberately:
//   1. re-open the renter's service window - every inbound does this
//   2. persist the message
//
// The window first, because that is the fact with a deadline attached. A
// message we failed to store can be recovered from Meta; a window we failed to
// extend silently blocks every reply for 24 hours.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { SupabaseMessageStore, upsertRenterByPhone } from '../_shared/whatsapp/store.ts';
import { recordInbound } from '../_shared/whatsapp/send.ts';
import {
  verifyMetaSignature,
  parseInboundMessages,
  verifySubscription,
  isOptOut,
} from '../_shared/whatsapp/inbound.ts';

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
      const renter = await upsertRenterByPhone(db, m.from);

      // Window first. See the note at the top of this file.
      await recordInbound(store, {
        renterId: renter.id,
        body: m.text,
        providerMessageId: m.providerMessageId,
        now: new Date(m.timestamp),
      });

      if (isOptOut(m.text)) {
        await db.from('renters')
          .update({ opted_out_at: new Date().toISOString() })
          .eq('id', renter.id);
        console.log(`[whatsapp-webhook] ${renter.id} opted out`);
      }
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
