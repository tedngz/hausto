// Reconcile templates.ts against what Meta actually says.
//
// The gap this closes is one a code flag structurally cannot: approval is not
// permanent. Meta REJECTS templates on resubmission, PAUSES ones whose quality
// drops, and DISABLES ones outright - and `approved: true` in the registry
// stays true through all of it. Without this, the first sign would be a
// graph_400 on the itinerary a renter was waiting for.
//
// It does NOT flip the code flag. That flag is a deploy gate and should stay
// one: a template nobody reviewed must not become sendable because an API said
// so. What it does is cache Meta's side in `whatsapp_template_status`, which
// `sendTemplate` consults alongside the flag - so a withdrawn approval stops a
// send, while a new approval still waits for a human.
//
// It also reads the number's own quality rating into `whatsapp_number_status`
// (number-health.ts), which the ops console shows and the digest sweep checks
// before it sends any marketing.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { parseMetaTemplates, reconcile, statusRows, summarise } from '../_shared/whatsapp/template-status.ts';
import { marketingHold, numberStatusRow, parseNumberHealth } from '../_shared/whatsapp/number-health.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WABA_ID = Deno.env.get('WHATSAPP_WABA_ID') || '';
const ACCESS_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN') || '';
const GRAPH_VERSION = Deno.env.get('WHATSAPP_GRAPH_VERSION') || 'v21.0';
const PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') || '';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// ── The number's own rating (number-health.ts) ─────────────────────────────
// Read before the templates and never allowed to fail the sync: a reading that
// could not be taken leaves the last one in place, with the error beside it.
// deno-lint-ignore no-explicit-any
async function syncNumber(db: any): Promise<Record<string, unknown> | null> {
  if (!PHONE_NUMBER_ID) return null;
  const now = new Date();
  try {
    const health = parseNumberHealth(await fetchNumber());
    const { data: prev } = await db
      .from('whatsapp_number_status').select('quality_rating').eq('id', 'singleton').maybeSingle();
    const row = numberStatusRow(health, (prev?.quality_rating as string | null) ?? null, now);
    const { error } = await db.from('whatsapp_number_status').upsert(row, { onConflict: 'id' });
    if (error) throw new Error(`store failed: ${error.message}`);

    const hold = marketingHold({ quality_rating: health.qualityRating, status: health.status });
    if (hold) {
      console.error(`[whatsapp-template-sync] NUMBER QUALITY: ${hold} - the digest holds itself until a reading comes back GREEN`);
    } else {
      console.log(`[whatsapp-template-sync] number: ${health.qualityRating}${health.status ? `, ${health.status}` : ''}`);
    }
    return { rating: health.qualityRating, status: health.status, hold };
  } catch (e) {
    const message = (e as Error).message;
    console.error('[whatsapp-template-sync] number check failed:', message);
    await db.from('whatsapp_number_status')
      .upsert({ id: 'singleton', last_error: message.slice(0, 300), updated_at: now.toISOString() }, { onConflict: 'id' });
    return { error: message };
  }
}

/** The number's reading; `quality_rating` alone if Meta refuses the wider field list. */
async function fetchNumber(): Promise<unknown> {
  let last = '';
  for (const fields of ['quality_rating,status', 'quality_rating']) {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}?fields=${fields}`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.json().catch(() => null);
    if (res.ok) return body;
    last = `graph_${res.status}: ${JSON.stringify(body?.error?.message ?? body).slice(0, 200)}`;
    // Only a field Meta does not know is worth a narrower retry.
    if (res.status !== 400) break;
  }
  throw new Error(last);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE);

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const cronSecret = req.headers.get('x-cron-secret') || '';
  let authorized = token === SERVICE_ROLE;
  if (!authorized && cronSecret) {
    const { data } = await db.rpc('verify_cron_secret', { _token: cronSecret });
    authorized = data === true;
  }
  if (!authorized) return json({ error: 'Unauthorized' }, 401);

  // Not configured yet is the normal state until the WABA exists, and it is not
  // a failure. Returning 200 keeps an hourly cron from filling the logs with
  // errors about a thing nobody has been able to do yet.
  if (!WABA_ID || !ACCESS_TOKEN) {
    const missing = [!WABA_ID && 'WHATSAPP_WABA_ID', !ACCESS_TOKEN && 'WHATSAPP_ACCESS_TOKEN']
      .filter(Boolean).join(', ');
    console.log(`[whatsapp-template-sync] skipped: ${missing} not set`);
    return json({ success: true, skipped: true, reason: `not configured: ${missing}` });
  }

  const number = await syncNumber(db);

  // ── Ask Meta ──────────────────────────────────────────────────────────────
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${WABA_ID}/message_templates` +
    '?fields=name,status,category,language,quality_score&limit=100';

  let payload: unknown;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      // Meta's error body is where the useful part is; a bare status says
      // nothing about which of many rejection reasons applied.
      console.error(`[whatsapp-template-sync] graph_${res.status}:`, JSON.stringify(body).slice(0, 400));
      return json({ error: 'graph_error', status: res.status, detail: body }, 502);
    }
    payload = body;
  } catch (e) {
    console.error('[whatsapp-template-sync] fetch failed:', (e as Error).message);
    return json({ error: 'fetch_failed', message: (e as Error).message }, 502);
  }

  const templates = parseMetaTemplates(payload);

  // ── Cache Meta's side ─────────────────────────────────────────────────────
  // Upsert rather than replace: a template that vanishes from Meta's list
  // should keep its last-known row, because "we no longer see it" is exactly
  // the case reconcile() needs to flag as CODE_AHEAD_OF_META rather than
  // silently forget.
  if (templates.length > 0) {
    const { error } = await db
      .from('whatsapp_template_status')
      .upsert(statusRows(templates), { onConflict: 'name' });
    if (error) {
      console.error('[whatsapp-template-sync] upsert failed:', error);
      return json({ error: 'cache_failed', message: error.message }, 500);
    }
  }

  // ── Compare with the code ─────────────────────────────────────────────────
  const drifts = reconcile(templates);
  const summary = summarise(drifts);

  // Urgent means the code believes it may send something Meta will reject.
  // Everything else - unsubmitted templates, approvals waiting on a deploy -
  // is the normal state of a system mid-setup and is logged quietly.
  if (summary.urgent > 0) {
    console.error(`[whatsapp-template-sync] TEMPLATE DRIFT: ${summary.message}`);
  } else {
    console.log(`[whatsapp-template-sync] ${templates.length} template(s) at Meta; ${summary.message}`);
  }

  return json({
    success: true,
    metaTemplates: templates.length,
    drifts,
    urgent: summary.urgent,
    number,
  });
});
