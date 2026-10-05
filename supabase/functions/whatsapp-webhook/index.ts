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
import { decideAction } from '../_shared/viewing/agent.ts';
import { performAction } from '../_shared/viewing/agent-act.ts';
import { adapterFromEnv } from '../_shared/whatsapp/adapter.ts';
import { releaseHeldItinerary } from '../_shared/viewing/deliver.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP_SECRET = Deno.env.get('WHATSAPP_APP_SECRET') || '';
const VERIFY_TOKEN = Deno.env.get('WHATSAPP_VERIFY_TOKEN') || '';

// The single switch. Off unless the value is exactly 'true', so a typo, an
// empty string, or the variable simply not existing all mean off - which is
// the direction a flag controlling automated outbound should fail in.
const AGENT_ENABLED = (Deno.env.get('VIEWING_AGENT_ENABLED') || '').trim() === 'true';

/**
 * Hand a search to viewing-agent-search.
 *
 * Fire and forget on failure: the renter's message is already stored and their
 * window already re-opened, and losing Meta's whole delivery batch to a failed
 * agent reply would be a far worse trade than a missed search.
 */
async function dispatchSearch(renterId: string, query: string, requestId?: string): Promise<void> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/viewing-agent-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE}` },
      body: JSON.stringify({ renterId, query, requestId, send: true }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) console.warn(`[whatsapp-webhook] agent search returned ${res.status}`);
  } catch (e) {
    console.warn('[whatsapp-webhook] agent search dispatch failed:', (e as Error).message);
  }
}

/**
 * Email the concierge about an availability request (notify-complex-inquiry).
 *
 * Fire and forget on failure, like the search: the message is stored and on
 * the request's thread in Admin Tools either way, and a mail outage must not
 * cost Meta's delivery batch.
 */
async function notifyConcierge(body: { inquiryId: string; event?: 'WHATSAPP_REPLY' }): Promise<void> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/notify-complex-inquiry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) console.warn(`[whatsapp-webhook] concierge notice returned ${res.status}`);
  } catch (e) {
    console.warn('[whatsapp-webhook] concierge notice failed:', (e as Error).message);
  }
}

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
      const outcome = await handleInbound(db, store, m);
      if (outcome.optedOut) console.log(`[whatsapp-webhook] ${outcome.renterId} opted out`);

      // A plan a template told them was ready (ITINERARY_HELD) goes now that
      // their message has opened the window - and is the one message this
      // reply gets, so the agent stands down rather than make it two.
      const released = outcome.optedOut
        ? null
        : await releaseHeldItinerary(db, adapterFromEnv(Deno.env.toObject()), outcome.renterId);
      if (released) {
        const r = released.result;
        console.log(`[whatsapp-webhook] held itinerary for ${released.requestId}: ${r.ok ? (r.held ? 'still held' : 'released') : r.code}`);
      }
      const standDown = released?.result.ok === true && !released.result.held;

      // Then at most one automated reply - only if the switch is on, apart
      // from the complex-watch replies (SPEC §11), which the renter asked for
      // on the site. `decideAction` is pure and returns a single action;
      // everything it declines routes to an operator.
      const action = standDown ? { kind: 'NONE' as const, reason: 'held itinerary released' } : decideAction({
        enabled: AGENT_ENABLED,
        intent: outcome.intent,
        text: m.text,
        requestId: outcome.requestId,
        optedOut: outcome.optedOut,
        confirmed: outcome.confirmed,
        selection: outcome.selection,
        watch: outcome.watch,
        alertMessageId: outcome.alertMessageId,
        inquiryId: outcome.inquiryId,
        lockIn: outcome.lockIn,
        link: outcome.link,
      });

      if (action.kind === 'NONE') {
        if (AGENT_ENABLED) console.log(`[whatsapp-webhook] agent passed: ${action.reason}`);
      } else if (action.kind === 'SEARCH') {
        // Dispatched rather than performed here: viewing-agent-search owns the
        // OpenAI call, the budget guard and the usage logging, and two places
        // that can spend money is one too many.
        await dispatchSearch(outcome.renterId, action.query, outcome.requestId);
      } else {
        const adapter = adapterFromEnv(Deno.env.toObject());
        const result = await performAction(db, adapter, action, {
          renterId: outcome.renterId,
          requestId: outcome.requestId,
          providerMessageId: m.providerMessageId,
        });
        if (result.error) console.warn(`[whatsapp-webhook] agent ${result.performed}: ${result.error}`);
        else console.log(`[whatsapp-webhook] agent ${result.performed}${result.ref ? ` -> ${result.ref}` : ''}`);
      }

      // The concierge hears about an availability request when it is
      // confirmed - not at the form, since until the code arrives there is
      // nobody to reply to - and about every WhatsApp reply on its thread.
      // After the renter's own reply above, so a slow mail send never delays it.
      if (outcome.watch?.kind === 'CONFIRMED' && outcome.watch.inquiry?.firstConfirm) {
        await notifyConcierge({ inquiryId: outcome.watch.inquiry.id });
      } else {
        for (const inquiryId of outcome.inquiryIds ?? []) {
          await notifyConcierge({ inquiryId, event: 'WHATSAPP_REPLY' });
        }
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
