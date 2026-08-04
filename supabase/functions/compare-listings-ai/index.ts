// Small scoped assistant for the compare dialog: given 2-4 shortlisted
// listings and a renter question, answer concisely from the listing data.
// Deliberately separate from chat-ai (conversational search) - the listings are
// the whole world here. Multi-turn: the client replays the thread as `history`,
// so the endpoint itself stays stateless and cheap (gpt-4o-mini).
import { logOpenAIUsage } from '../_shared/openai-usage.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(clientIp)) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
      status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { question, listings, preferences, history } = await req.json();
    if (!question || !Array.isArray(listings) || listings.length < 2 || listings.length > 4) {
      return new Response(JSON.stringify({ error: 'Provide a question and 2-4 listings' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Prior turns, oldest first. Capped so a long thread can't blow up the
    // prompt; only the shapes we emit are trusted through.
    const priorTurns = (Array.isArray(history) ? history : [])
      .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string')
      .slice(-8)
      .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 1500) }));

    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) throw new Error('OPENAI_API_KEY not configured');

    const compact = listings.map((l: any, i: number) => ({
      option: i + 1,
      title: String(l.title || '').slice(0, 120),
      location: String(l.location || '').slice(0, 120),
      price_usd_per_month: l.price_usd ?? null,
      rooms: l.rooms ?? null,
      size: l.size ?? null,
      vibe: l.vibe ?? null,
      amenities: (l.amenities || []).slice(0, 20),
      highlights: (l.highlights || []).slice(0, 8),
      last_verified_at: l.last_verified_at ?? null,
      postings_by_agents: l.posting_count ?? 1,
    }));

    // Listings live in the system message so they stay stable context across a
    // multi-turn thread instead of being restated on every question.
    const sys = `You are Hausto's rental comparison assistant for expats in Vietnam. The renter has shortlisted these listings and needs help deciding. Answer ONLY from the provided listing data - if something isn't in the data (exact fees, pet policy, availability), say so and suggest confirming at the viewing. Be concise: 3-6 sentences or a short bullet list. Refer to listings by their option number and short name. When a recommendation is asked for, give one, with the tradeoff stated plainly.

This is an ongoing conversation - the renter may ask follow-ups that refer back to what you already said. Don't repeat a full comparison when they ask something narrow; just answer it.

Write plain conversational text. Do NOT use markdown: no **bold**, no *italics*, no ### headings, no tables. For a list, start each line with "- ". Use "-" not em dashes.

Reply with JSON only, shaped exactly:
{"answer": "your reply", "followups": ["...", "..."]}
"followups" holds 2-3 short questions the renter would plausibly ask next, in their voice ("Is Option 1 worth the extra $400?"), each under 45 characters. They must follow from what you just said and be answerable from the listing data. Never repeat a question already asked in this conversation. Use [] if nothing useful follows.

Listings:
${JSON.stringify(compact, null, 1)}${preferences ? `\n\nRenter preferences: ${JSON.stringify(preferences).slice(0, 600)}` : ''}`;

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 500,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: sys },
          ...priorTurns,
          { role: 'user', content: String(question).slice(0, 500) },
        ],
      }),
    });
    if (!resp.ok) {
      const detail = await resp.text();
      console.error('[compare-listings-ai] OpenAI error:', resp.status, detail.slice(0, 300));
      throw new Error(`AI request failed (${resp.status})`);
    }
    const data = await resp.json();
    logOpenAIUsage({ fn: 'compare-listings-ai', model: 'gpt-4o-mini', usage: data?.usage });
    const raw = data.choices?.[0]?.message?.content?.trim() || '';

    // JSON mode should guarantee the shape, but a malformed reply must still
    // produce a usable answer rather than dumping braces into the chat.
    let answer = '';
    let followups: string[] = [];
    try {
      const parsed = JSON.parse(raw);
      answer = String(parsed?.answer || '').trim();
      followups = (Array.isArray(parsed?.followups) ? parsed.followups : [])
        .filter((f: any) => typeof f === 'string' && f.trim())
        .slice(0, 3)
        .map((f: string) => f.trim().slice(0, 80));
    } catch {
      console.error('[compare-listings-ai] Non-JSON reply:', raw.slice(0, 200));
      answer = raw;
    }
    if (!answer) answer = 'Sorry, I could not analyze these listings.';

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
