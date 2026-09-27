// The follow-up search: a renter's sentence becomes three listings.
//
// PLAN-v3 scopes the agent narrowly and this is one of its four jobs. What it
// is NOT is open-ended conversation or first-time discovery - the style layer
// is visual, and WhatsApp cannot render a filterable grid worth looking at.
//
// Two things it does not decide for itself, both deliberate:
//
//   1. **It is not wired to fire on every inbound.** Turning it on means an
//      LLM call plus a billed reply for any message that looks like a
//      question, which is a spend decision rather than a code one. The
//      capability is here and the caller chooses.
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
import { SupabaseMessageStore } from '../_shared/whatsapp/store.ts';
import { sendFreeForm, ServiceWindowClosedError, ConsecutiveMessageError } from '../_shared/whatsapp/send.ts';
import {
  validateFilters,
  toQueryString,
  renderSearchResults,
  EXTRACTION_PROMPT,
  type SearchResult,
} from '../_shared/viewing/search.ts';
import { isOpenAIBudgetExhausted, logOpenAIUsage } from '../_shared/openai-usage.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') || '';
const SITE_URL = Deno.env.get('PUBLIC_SITE_URL') || 'https://hausto.com';

// The house model - 15 other functions use it, and extracting five fields from
// one sentence is not work that needs anything larger.
const MODEL = 'gpt-4o-mini';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Service role, cron secret, or an ops user. Never the renter's own client:
  // this spends money per call and sends from our number.
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  let authorized = token === SERVICE_ROLE;
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
      authorized = !!role;
    }
  }
  if (!authorized) return json({ error: 'Unauthorized' }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const renterId = String(body.renterId ?? '');
  const query = String(body.query ?? '').trim().slice(0, 500);
  const requestId = body.requestId ? String(body.requestId) : undefined;
  // Default false: a caller has to mean it. Returning the draft lets the
  // wiring be tested, and the ops console preview it, without spending a send.
  const send = body.send === true;

  if (!renterId || !query) return json({ error: 'renterId and query are required' }, 400);
  if (!OPENAI_API_KEY) return json({ error: 'openai_not_configured' }, 500);

  // The budget guard the other OpenAI functions use. A spend cap that one
  // function ignores is not a spend cap.
  if (await isOpenAIBudgetExhausted()) {
    return json({ error: 'budget_exhausted', message: 'Daily OpenAI budget reached.' }, 429);
  }

  // ── Sentence → filters ────────────────────────────────────────────────────
  let parsed: unknown;
  try {
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
        messages: [
          { role: 'system', content: EXTRACTION_PROMPT },
          { role: 'user', content: query },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      console.error('[viewing-agent-search] openai error:', JSON.stringify(data).slice(0, 300));
      return json({ error: 'llm_failed', status: res.status }, 502);
    }
    logOpenAIUsage({ fn: 'viewing-agent-search', model: MODEL, usage: data?.usage, metadata: { renterId } });
    parsed = JSON.parse(data?.choices?.[0]?.message?.content ?? '{}');
  } catch (e) {
    console.error('[viewing-agent-search] extraction failed:', (e as Error).message);
    return json({ error: 'llm_failed', message: (e as Error).message }, 502);
  }

  const validation = validateFilters(parsed);
  if (!validation.ok) return json({ error: 'unparseable_filters', detail: validation.error }, 502);
  if (validation.dropped.length > 0) {
    // Not an error - a dropped filter is a broader search. Logged because a
    // field dropped on every call means the prompt and the contract disagree.
    console.log(`[viewing-agent-search] dropped: ${validation.dropped.join(', ')}`);
  }

  // ── Filters → listings ────────────────────────────────────────────────────
  let results: SearchResult[] = [];
  try {
    const url = `${SUPABASE_URL}/functions/v1/public-property-search?${toQueryString(validation.filters!)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${SERVICE_ROLE}` },
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      console.error('[viewing-agent-search] search failed:', res.status);
      return json({ error: 'search_failed', status: res.status }, 502);
    }
    results = (data?.results ?? []) as SearchResult[];
  } catch (e) {
    return json({ error: 'search_failed', message: (e as Error).message }, 502);
  }

  // ── Correct the prices before quoting them ────────────────────────────────
  //
  // The search endpoint used to return `price_vnd: Number(p.price)` - the raw
  // column, which holds USD for housingsgn rows (SPEC §0: a live row reads
  // price = 730, price_display = '$730 / month'), so a renter would have been
  // told a $730 flat costs 730 dong. It now emits the canonical column, but
  // the read stays: it supplies district_code, which the response does not
  // carry at all, and it drops the price of a listing that went inactive
  // between the search and now.
  if (results.length > 0) {
    const ids = results.map(r => r.id);
    const { data: canonical } = await db
      .from('external_properties')
      .select('id, price_vnd, price_display, district_code')
      .in('id', ids);
    const byId = new Map((canonical ?? []).map((c: Record<string, unknown>) => [c.id, c]));
    results = results.map(r => {
      const c = byId.get(r.id);
      return c
        ? {
            ...r,
            price_vnd: (c.price_vnd as number) ?? null,
            price_display: (c.price_display as string) ?? r.price_display ?? null,
            district_code: (c.district_code as string) ?? null,
          }
        // No canonical row means the listing went inactive between the search
        // and now. Dropping the price beats quoting an uncorrected one.
        : { ...r, price_vnd: null };
    });
  }

  let ref: string | undefined;
  if (requestId) {
    const { data } = await db.from('viewing_requests').select('ref').eq('id', requestId).maybeSingle();
    ref = data?.ref;
  }

  const text = renderSearchResults({ results, siteUrl: SITE_URL, ref });

  if (!send) {
    return json({ success: true, sent: false, filters: validation.filters, matched: results.length, preview: text });
  }

  // ── One message ───────────────────────────────────────────────────────────
  const store = new SupabaseMessageStore(db);
  let adapter;
  try { adapter = adapterFromEnv(Deno.env.toObject()); }
  catch (e) { return json({ error: (e as Error).message }, 500); }

  try {
    const result = await sendFreeForm(store, adapter, {
      renterId,
      requestId,
      // Keyed on the query so the same question twice is one send, and a retry
      // after a timeout cannot double-message.
      purpose: `AGENT_SEARCH:${await hash(query)}`,
      body: text,
    });
    return json({
      success: true, sent: true, messageId: result.message.id,
      deduplicated: result.deduplicated, matched: results.length, preview: text,
    });
  } catch (e) {
    if (e instanceof ServiceWindowClosedError) {
      return json({ error: 'service_window_closed', message: e.message, preview: text }, 409);
    }
    if (e instanceof ConsecutiveMessageError) {
      return json({ error: 'too_many_consecutive', message: e.message, preview: text }, 429);
    }
    return json({ error: 'send_failed', message: (e as Error).message, preview: text }, 500);
  }
});

/** Short stable digest of the query, for the idempotency key. */
async function hash(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].slice(0, 6).map(b => b.toString(16).padStart(2, '0')).join('');
}
