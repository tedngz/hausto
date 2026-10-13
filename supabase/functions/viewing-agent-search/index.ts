// WhatsApp search: a renter's messages become three listings.
//
// PLAN-v3 scoped this to the follow-up search; since 2026-10-13 it also answers
// a cold DM - a number that has never made a request (owner's decision). The
// run itself is _shared/viewing/search-run.ts, which the rehearsal drives on
// FakeDb; this is the wiring: who may call, the model, the endpoint, chat-ai's
// credit counter and the clock.
//
// Two things it does not decide for itself, both deliberate:
//
//   1. **It is not wired to fire on every inbound.** The webhook calls it for
//      what the agent reads as a search (agent.ts), and only with
//      VIEWING_AGENT_ENABLED on. What one may cost, and who may spend it, is
//      search-limits.ts.
//   2. **It never sends more than one message.** PLAN-v3's "one photo and two
//      lines each" cannot be honoured literally - a photo is its own WhatsApp
//      message, so three photos is three messages and `sendFreeForm` refuses
//      at the third. The link previews an image on the renter's device, so the
//      picture arrives without the message count.
//
// Everything the model returns crosses `validateFilters` before it reaches
// `public-property-search`, which is a stable contract shared with ChatGPT and
// Perplexity via llms.txt and must not be bent by anything here.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { adapterFromEnv } from '../_shared/whatsapp/adapter.ts';
import { toQueryString, type SearchFilters, type SearchResult } from '../_shared/viewing/search.ts';
import { runSearch, searchOnce, type ChatMessage, type SearchDeps } from '../_shared/viewing/search-run.ts';
import { aiCreditKey } from '../_shared/ai-credits.ts';
import { isOpenAIBudgetExhausted, logOpenAIUsage } from '../_shared/openai-usage.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') || '';
const SITE_URL = Deno.env.get('PUBLIC_SITE_URL') || 'https://hausto.com';
const UPSTASH_REDIS_REST_URL = Deno.env.get('UPSTASH_REDIS_REST_URL');
const UPSTASH_REDIS_REST_TOKEN = Deno.env.get('UPSTASH_REDIS_REST_TOKEN');

// The house model - 15 other functions use it, and extracting five fields from
// a few sentences is not work that needs anything larger.
const MODEL = 'gpt-4o-mini';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** Messages in, the model's JSON out. Throws, so the run un-counts the search. */
async function extract(messages: ChatMessage[], renterId: string): Promise<unknown> {
  if (!OPENAI_API_KEY) throw new Error('openai_not_configured');
  // The budget guard the other OpenAI functions use. A spend cap that one
  // function ignores is not a spend cap.
  if (await isOpenAIBudgetExhausted()) throw new Error('budget_exhausted');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      // Forces valid JSON out, which removes the whole class of "the model
      // wrapped it in a markdown fence" parsing failures.
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 200,
      messages,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    console.error('[viewing-agent-search] openai error:', JSON.stringify(data).slice(0, 300));
    throw new Error(`llm_failed: ${res.status}`);
  }
  logOpenAIUsage({ fn: 'viewing-agent-search', model: MODEL, usage: data?.usage, metadata: { renterId } });
  return JSON.parse(data?.choices?.[0]?.message?.content ?? '{}');
}

async function search(filters: SearchFilters): Promise<SearchResult[]> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/public-property-search?${toQueryString(filters)}`, {
    headers: { Authorization: `Bearer ${SERVICE_ROLE}` },
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`search_failed: ${res.status}`);
  return (data?.results ?? []) as SearchResult[];
}

/** One Upstash REST command, or null when Redis is not configured. */
async function redis(path: string): Promise<unknown> {
  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) return null;
  const resp = await fetch(`${UPSTASH_REDIS_REST_URL}/${path}`, {
    headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!resp.ok) throw new Error(`redis ${resp.status}`);
  return (await resp.json())?.result ?? null;
}

/**
 * chat-ai's counter, on chat-ai's key (ai-credits.ts), so a renter's web chat
 * and WhatsApp searches spend one allowance. Null on any failure: chat-ai
 * fails open too, and the number's own cap still holds.
 */
const credits: SearchDeps['credits'] = {
  async spend(userId) {
    try {
      const key = encodeURIComponent(aiCreditKey(userId));
      const spent = Number(await redis(`incr/${key}`));
      await redis(`expire/${key}/${60 * 60 * 48}`);
      return Number.isFinite(spent) && spent > 0 ? spent : null;
    } catch (e) {
      console.warn('[viewing-agent-search] credit counter unavailable:', (e as Error).message);
      return null;
    }
  },
  async refund(userId) {
    await redis(`decr/${encodeURIComponent(aiCreditKey(userId))}`);
  },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Service role, cron secret, or an ops user. Never the renter's own client:
  // this spends money per call and sends from our number.
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  let authorized = token === SERVICE_ROLE;
  let isOps = false;
  if (!authorized) {
    const cronSecret = req.headers.get('x-cron-secret') || '';
    if (cronSecret) {
      const { data } = await db.rpc('verify_cron_secret', { _token: cronSecret });
      authorized = data === true;
    }
  }
  if (!authorized) {
    const { data: userData } = await db.auth.getUser(token);
    const userId = userData?.user?.id;
    if (userId) {
      const { data: role } = await db
        .from('user_roles').select('role').eq('user_id', userId).eq('role', 'ops').maybeSingle();
      authorized = isOps = !!role;
    }
  }
  if (!authorized) return json({ error: 'Unauthorized' }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const renterId = String(body.renterId ?? '');
  const requestId = body.requestId ? String(body.requestId) : undefined;
  // Default false: a caller has to mean it. Returning the draft lets the
  // wiring be tested, and the ops console preview it, without spending a send.
  const send = body.send === true;
  if (!renterId) return json({ error: 'renterId is required' }, 400);

  const deps: SearchDeps = {
    extract: (messages) => extract(messages, renterId),
    search,
    credits,
    sleep: (ms) => new Promise(r => setTimeout(r, ms)),
    now: () => new Date(),
    siteUrl: SITE_URL,
  };

  if (!send) {
    const query = String(body.query ?? '').trim().slice(0, 500);
    if (!query) return json({ error: 'query is required for a preview' }, 400);
    try {
      const found = await searchOnce(db, query, null, deps);
      return json({ success: true, sent: false, filters: found.filters, matched: found.results.length, preview: found.text });
    } catch (e) {
      return json({ error: 'search_failed', message: (e as Error).message }, 502);
    }
  }

  // Sending is the webhook's: it answers the renter's own messages, which is
  // what the claim and the quota are keyed on. An operator previews.
  if (isOps) return json({ error: 'Operators preview with send: false' }, 403);
  const triggerMessageId = String(body.triggerMessageId ?? '');
  if (!triggerMessageId) return json({ error: 'triggerMessageId is required to send' }, 400);

  let adapter;
  try { adapter = adapterFromEnv(Deno.env.toObject()); }
  catch (e) { return json({ error: (e as Error).message }, 500); }

  const run = runSearch(db, adapter, { renterId, triggerMessageId, requestId }, deps)
    .then(r => {
      console.log(`[viewing-agent-search] ${renterId}: ${r.status}${'reason' in r ? ` ${r.reason}` : ''}${'error' in r ? ` ${r.error}` : ''}`);
      return r;
    })
    .catch(e => {
      console.error('[viewing-agent-search] run failed:', e);
      return null;
    });

  // The run waits for the renter to stop typing, so it outlives the request:
  // answered now, finished in the background. The webhook must not hold
  // Meta's delivery open for it.
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (rt?.waitUntil) {
    rt.waitUntil(run);
    return json({ success: true, accepted: true }, 202);
  }
  return json({ success: true, result: await run });
});
