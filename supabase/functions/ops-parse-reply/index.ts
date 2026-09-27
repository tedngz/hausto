// Paste-parse (SPEC §4, gap 8 in the AI operator plan): an agent's Zalo reply
// in, a suggested outcome out.
//
// Suggests and never applies. It writes nothing - no event, no message row,
// not even the reply itself, which is stored when the operator records the
// outcome it belongs to. The model never writes to the log; the operator does,
// after reading what this filled in.
//
// The reading is `_shared/viewing/parse-reply.ts`, pure and tested; this is the
// I/O around it: prove the caller is ops, load the item's listing and the
// renter's windows, spend one bounded model call under the daily cap.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import {
  PARSE_MODEL,
  PARSE_PROMPT,
  MAX_REPLY_CHARS,
  buildParseInput,
  interpretParse,
} from '../_shared/viewing/parse-reply.ts';
import { isOpenAIBudgetExhausted, logOpenAIUsage } from '../_shared/openai-usage.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') || '';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE);

  // An operator, and only an operator: this spends model budget per call.
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const { data: userData } = await db.auth.getUser(token);
  const userId = userData?.user?.id ?? null;
  if (!userId) return json({ error: 'Unauthorized' }, 401);
  const { data: role } = await db
    .from('user_roles').select('role').eq('user_id', userId).eq('role', 'ops').maybeSingle();
  if (!role) return json({ error: 'Forbidden' }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const itemId = String(body.itemId ?? '');
  const reply = String(body.reply ?? '').trim();
  if (!itemId || !reply) return json({ error: 'itemId and reply are required' }, 400);
  if (reply.length > MAX_REPLY_CHARS) {
    return json({ error: 'reply_too_long', message: `Paste the agent's reply only - ${reply.length} characters is more than ${MAX_REPLY_CHARS}.` }, 400);
  }

  const { data: item } = await db
    .from('ops_request_items_view')
    .select('id, request_id, listing_title, price_vnd_at_request')
    .eq('id', itemId)
    .maybeSingle();
  if (!item) return json({ error: 'Unknown item' }, 404);
  const { data: request } = await db
    .from('viewing_requests').select('availability').eq('id', item.request_id).maybeSingle();

  if (!OPENAI_API_KEY) return json({ error: 'openai_not_configured' }, 500);
  // The cap every OpenAI function honours. A spend cap one function ignores is
  // not a spend cap.
  if (await isOpenAIBudgetExhausted()) {
    return json({ error: 'budget_exhausted', message: 'Daily OpenAI budget reached - pick the outcome by hand.' }, 429);
  }

  const ctx = {
    reply,
    listingTitle: String(item.listing_title ?? 'the unit'),
    priceVnd: Number(item.price_vnd_at_request ?? 0),
    availability: Array.isArray(request?.availability) ? request.availability : [],
    now: new Date(),
  };

  let parsed: unknown;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: PARSE_MODEL,
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: 300,
        messages: [
          { role: 'system', content: PARSE_PROMPT },
          { role: 'user', content: buildParseInput(ctx) },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      console.error('[ops-parse-reply] openai error:', JSON.stringify(data).slice(0, 300));
      return json({ error: 'llm_failed', status: res.status }, 502);
    }
    logOpenAIUsage({ fn: 'ops-parse-reply', model: PARSE_MODEL, usage: data?.usage, metadata: { itemId } });
    parsed = JSON.parse(data?.choices?.[0]?.message?.content ?? '{}');
  } catch (e) {
    console.error('[ops-parse-reply] failed:', (e as Error).message);
    return json({ error: 'llm_failed', message: (e as Error).message }, 502);
  }

  return json({ success: true, suggestion: interpretParse(parsed, ctx) });
});
