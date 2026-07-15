// Small scoped assistant for the compare dialog: given 2-4 shortlisted
// listings and a renter question, answer concisely from the listing data.
// Deliberately separate from chat-ai (conversational search) - this endpoint
// is stateless and cheap (gpt-4o-mini).
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
    const { question, listings, preferences } = await req.json();
    if (!question || !Array.isArray(listings) || listings.length < 2 || listings.length > 4) {
      return new Response(JSON.stringify({ error: 'Provide a question and 2-4 listings' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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

    const sys = `You are Hausto's rental comparison assistant for expats in Vietnam. The renter has shortlisted these listings and needs help deciding. Answer ONLY from the provided listing data - if something isn't in the data (exact fees, pet policy, availability), say so and suggest confirming at the viewing. Be concise: 3-6 sentences or a short bullet list. Refer to listings by their option number and short name. Use "-" not em dashes. When a recommendation is asked for, give one, with the tradeoff stated plainly.`;

    const userMsg = `Listings:\n${JSON.stringify(compact, null, 1)}\n${preferences ? `\nRenter preferences: ${JSON.stringify(preferences).slice(0, 600)}\n` : ''}\nQuestion: ${String(question).slice(0, 500)}`;

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 400,
        temperature: 0.3,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: userMsg },
        ],
      }),
    });
    if (!resp.ok) {
      const detail = await resp.text();
      console.error('[compare-listings-ai] OpenAI error:', resp.status, detail.slice(0, 300));
      throw new Error(`AI request failed (${resp.status})`);
    }
    const data = await resp.json();
    const answer = data.choices?.[0]?.message?.content?.trim() || 'Sorry, I could not analyze these listings.';

    return new Response(JSON.stringify({ answer }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[compare-listings-ai] Error:', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
