// The door the always-on Zalo device talks to (stage 3, bridge/README.md).
//
// Three calls, all POST with a JSON body carrying `action`:
//
//   pull     heartbeat, then: the messages to send (claimed for this device),
//            and the agent numbers whose replies it may forward
//   ack      for each message it tried: sent, or failed and why
//   inbound  the agents' messages it saw
//
// Authenticated by ZALO_BRIDGE_TOKEN, a long random secret shared with the
// device and nothing else. The device cannot present a Supabase JWT, and a
// token that only reaches this function is a smaller key to lose than the
// service role. The logic is `_shared/realtor/bridge.ts`, tested.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { bridgePull, bridgeAck, bridgeInbound, bridgeHeartbeat } from '../_shared/realtor/bridge.ts';
import { renderAgentReplyAlert } from '../_shared/viewing/inquiry-deadline.ts';
import { sendIntakeAlert } from '../_shared/viewing/ops-alert.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BRIDGE_TOKEN = (Deno.env.get('ZALO_BRIDGE_TOKEN') || '').trim();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Constant-time, so the token cannot be guessed a character at a time. */
function sameToken(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/**
 * Tell the ops team an agent answered an availability check (S7.2). One email
 * per reply: they are few, and each is somebody's cue to act.
 */
// deno-lint-ignore no-explicit-any
async function alertAgentReplies(db: any, replies: { inquiryId: string; fromPhone: string; text: string }[]): Promise<void> {
  for (const r of replies) {
    try {
      const { data: inq } = await db.from('complex_inquiries').select('complex_id').eq('id', r.inquiryId).maybeSingle();
      const { data: complex } = inq
        ? await db.from('complexes').select('name').eq('id', inq.complex_id).maybeSingle()
        : { data: null };
      const { data: agent } = await db.from('realtors').select('display_name').eq('phone_e164', r.fromPhone).maybeSingle();
      await sendIntakeAlert(db, renderAgentReplyAlert({
        complexName: complex?.name ?? 'a building', agentName: agent?.display_name ?? null, text: r.text,
      }), Deno.env.get('RESEND_API_KEY'));
    } catch (e) {
      console.warn('[zalo-bridge] agent reply alert failed:', (e as Error).message);
    }
  }
}

/** Ask the planner to read new replies now rather than at its next tick. */
async function planNow(requestIds: string[]): Promise<void> {
  for (const requestId of requestIds) {
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/ai-operator-plan`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SERVICE_ROLE}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      // The next scheduled pass reads it anyway.
      console.warn('[zalo-bridge] planner nudge failed:', (e as Error).message);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  // A short token is a guessable one. Refusing to run with one beats running.
  if (BRIDGE_TOKEN.length < 32) {
    console.error('[zalo-bridge] ZALO_BRIDGE_TOKEN is missing or shorter than 32 characters');
    return json({ error: 'bridge_not_configured' }, 503);
  }
  if (!sameToken((req.headers.get('x-bridge-token') || '').trim(), BRIDGE_TOKEN)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE);
  const now = new Date();

  switch (String(body.action ?? '')) {
    case 'pull': {
      await bridgeHeartbeat(db, {
        device: body.device as string, version: body.version as string,
        sentToday: body.sentToday as number, error: body.error as string | null,
      }, now);
      return json(await bridgePull(db, now));
    }

    case 'ack': {
      const acks = Array.isArray(body.acks) ? body.acks.slice(0, 50) : [];
      const results = [];
      for (const a of acks as Record<string, unknown>[]) {
        results.push(await bridgeAck(db, {
          messageId: String(a.messageId ?? ''), sent: a.sent === true,
          providerId: a.providerId ? String(a.providerId) : undefined,
          error: a.error ? String(a.error) : undefined,
        }, now));
      }
      return json({ results });
    }

    case 'inbound': {
      const messages = Array.isArray(body.messages) ? body.messages.slice(0, 50) : [];
      const results = [];
      const touched = new Set<string>();
      const answered: { inquiryId: string; fromPhone: string; text: string }[] = [];
      for (const m of messages as Record<string, unknown>[]) {
        const r = await bridgeInbound(db, {
          fromPhone: String(m.fromPhone ?? ''), text: String(m.text ?? ''),
          providerMessageId: String(m.providerMessageId ?? ''),
        });
        if (r.stored && 'requestId' in r) touched.add(r.requestId);
        if (r.stored && 'inquiryId' in r) {
          answered.push({ inquiryId: r.inquiryId, fromPhone: String(m.fromPhone ?? ''), text: String(m.text ?? '') });
        }
        results.push(r);
      }
      const after = Promise.all([planNow([...touched]), alertAgentReplies(db, answered)]);
      (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(after);
      return json({ results });
    }

    default:
      return json({ error: `Unknown action: ${String(body.action)}` }, 400);
  }
});
