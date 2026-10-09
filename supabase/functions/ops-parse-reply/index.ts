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
//
// With `inquiryId` instead of `itemId` it reads a building agent's answer to
// an availability check into suggested units (`unit-parse.ts`, S7.2b), for the
// console's capture form. Same rule: it suggests, the operator adds the unit.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { PARSE_MODEL, MAX_REPLY_CHARS } from '../_shared/viewing/parse-reply.ts';
import { callParseModel, callUnitParseModel } from '../_shared/viewing/parse-call.ts';
import { UNIT_PARSE_MODEL } from '../_shared/viewing/unit-parse.ts';
import { briefOf } from '../_shared/viewing/offer.ts';
import { placeOf } from '../_shared/viewing/place.ts';
import { reduceInquiry, type InquiryEvent } from '../_shared/viewing-domain.ts';
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
  const inquiryId = String(body.inquiryId ?? '');
  const reply = String(body.reply ?? '').trim();
  if ((!itemId && !inquiryId) || !reply) return json({ error: 'itemId or inquiryId, and reply, are required' }, 400);
  if (reply.length > MAX_REPLY_CHARS) {
    return json({ error: 'reply_too_long', message: `Paste the agent's reply only - ${reply.length} characters is more than ${MAX_REPLY_CHARS}.` }, 400);
  }
  if (!OPENAI_API_KEY) return json({ error: 'openai_not_configured' }, 500);

  if (inquiryId) {
    const { data: inq } = await db.from('complex_inquiries')
      .select('id, complex_id, area_district_codes, area_label, bedrooms_needed, budget_max_vnd').eq('id', inquiryId).maybeSingle();
    if (!inq) return json({ error: 'Unknown request' }, 404);
    // A building, or an area (Priority search).
    const [place, { data: events }] = await Promise.all([
      placeOf(db, inq),
      db.from('inquiry_events').select('id, inquiry_id, type, payload, actor, occurred_at').eq('inquiry_id', inquiryId),
    ]);
    if (await isOpenAIBudgetExhausted()) {
      return json({ error: 'budget_exhausted', message: 'Daily OpenAI budget reached - fill the unit in by hand.' }, 429);
    }
    const view = reduceInquiry(inquiryId, (events ?? []) as InquiryEvent[]);
    const result = await callUnitParseModel({
      reply,
      complexName: place?.name ?? 'the building',
      brief: briefOf({ bedrooms: Number(inq.bedrooms_needed), budgetMaxVnd: inq.budget_max_vnd ?? null }, view.brief),
      now: new Date(),
    }, OPENAI_API_KEY);
    if (!result.ok) {
      console.error('[ops-parse-reply] unit parse failed:', result.error);
      return json({ error: 'llm_failed', message: 'The reply could not be read - fill the unit in by hand.' }, 502);
    }
    logOpenAIUsage({
      fn: 'ops-parse-reply', model: UNIT_PARSE_MODEL,
      usage: result.usage as { prompt_tokens?: number; completion_tokens?: number } | null, metadata: { inquiryId },
    });
    return json({ success: true, units: result.suggestion });
  }

  const { data: item } = await db
    .from('ops_request_items_view')
    .select('id, request_id, listing_title, price_vnd_at_request')
    .eq('id', itemId)
    .maybeSingle();
  if (!item) return json({ error: 'Unknown item' }, 404);
  const { data: request } = await db
    .from('viewing_requests').select('availability').eq('id', item.request_id).maybeSingle();

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

  const result = await callParseModel(ctx, OPENAI_API_KEY);
  if (!result.ok) {
    console.error('[ops-parse-reply] failed:', result.error);
    return json({ error: 'llm_failed', message: 'The reply could not be read - pick the outcome by hand.' }, 502);
  }
  logOpenAIUsage({
    fn: 'ops-parse-reply', model: PARSE_MODEL,
    usage: result.usage as { prompt_tokens?: number; completion_tokens?: number } | null, metadata: { itemId },
  });
  return json({ success: true, suggestion: result.suggestion });
});
