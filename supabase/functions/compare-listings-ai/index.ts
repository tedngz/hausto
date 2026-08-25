// Small scoped assistant for the compare dialog: given 2-4 shortlisted
// listings and a renter question, answer concisely from the listing data.
// Deliberately separate from chat-ai (conversational search) - the listings are
// the whole world here. Multi-turn: the client replays the thread as `history`,
// so the endpoint itself stays stateless and cheap (gpt-4o-mini).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isOpenAIBudgetExhausted } from '../_shared/openai-usage.ts';
import { identifyCaller, isRateLimited } from '../_shared/rate-limit.ts';
import { askCompare } from '../_shared/compare-listings.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// /browse is a public page, so the compare dialog has to keep working for
// visitors who have not signed up - the endpoint stays open, but a stranger
// gets a much smaller allowance than someone with an account. The counters live
// in Redis (see _shared/rate-limit.ts): the old in-memory Map reset on every
// cold start and keyed off the leftmost X-Forwarded-For entry, which is written
// by the caller, so a request could pick its own bucket.
const ANON_LIMIT = 8;
const USER_LIMIT = 40;
const RATE_WINDOW_SEC = 300;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  const caller = await identifyCaller(req, supabase);
  const limit = caller.userId ? USER_LIMIT : ANON_LIMIT;
  if (!caller.isServiceRole && await isRateLimited(`compare:${caller.key}`, limit, RATE_WINDOW_SEC)) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
      status: 429,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': String(RATE_WINDOW_SEC) },
    });
  }

  // Hard stop on the day's spend, shared with every other AI endpoint. This is
  // the backstop that still holds if the per-caller counters are evaded.
  if (await isOpenAIBudgetExhausted()) {
    return new Response(JSON.stringify({
      answer: 'The comparison assistant is taking a short break - please try again a bit later.',
      followups: [],
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const { question, listings, preferences, history } = await req.json();
    if (!question || !Array.isArray(listings) || listings.length < 2 || listings.length > 4) {
      return new Response(JSON.stringify({ error: 'Provide a question and 2-4 listings' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) throw new Error('OPENAI_API_KEY not configured');

    // The prompt and the OpenAI call live in _shared/compare-listings.ts: the
    // hub's chat answers the same question when a renter pins listings there,
    // and one comparison should not have two definitions to drift apart.
    const { answer, followups } = await askCompare({
      question,
      listings: listings.map((l: any) => ({
        title: l.title,
        location: l.location,
        price_usd: l.price_usd ?? null,
        rooms: l.rooms ?? null,
        size: l.size ?? null,
        vibe: l.vibe ?? null,
        amenities: l.amenities ?? [],
        highlights: l.highlights ?? [],
        last_verified_at: l.last_verified_at ?? null,
        posting_count: l.posting_count ?? null,
      })),
      preferences,
      history,
      openaiKey,
      fn: 'compare-listings-ai',
    });

    return new Response(JSON.stringify({ answer, followups }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[compare-listings-ai] Error:', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
