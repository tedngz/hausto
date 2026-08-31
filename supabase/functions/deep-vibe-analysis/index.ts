import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { isOpenAIBudgetExhausted, logOpenAIUsage } from "../_shared/openai-usage.ts";

// The deep read behind the Hausto Pass: what this apartment is actually like to
// live in, written against this renter's preferences, from the listing photos.
//
// Deliberately not a branch inside analyze-vibe. That function scores images for
// the catalogue - one shared answer per listing, no renter in the picture. This
// one is per renter and per preference shape, and its whole value is the part a
// catalogue-wide answer cannot have: whether it suits *you*, and what's wrong
// with it that the listing won't say.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MODEL = 'gpt-4o-mini';
// Enough photos to read a floor plan and spot the problems, few enough that one
// generation stays cheap against a $25 pass with unlimited reads.
const MAX_IMAGES = 5;

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[DEEP-VIBE-ANALYSIS] ${step}${detailsStr}`);
};

/** Stable hash of the preferences a read was written against. */
const fingerprint = async (prefs: Record<string, unknown> | null): Promise<string> => {
  // Only the fields the answer actually turns on, in a fixed order - so an
  // unrelated profile edit doesn't throw away a cache entry that's still right.
  const shape = prefs
    ? [
        (prefs.styles as string[] ?? []).slice().sort().join(','),
        (prefs.location as string[] ?? []).slice().sort().join(','),
        (prefs.must_haves as string[] ?? []).slice().sort().join(','),
        (prefs.activities as string[] ?? []).slice().sort().join(','),
        String(prefs.size ?? ''),
        String(prefs.price_range_min ?? ''),
        String(prefs.price_range_max ?? ''),
      ].join('|')
    : 'no-preferences';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(shape));
  return Array.from(new Uint8Array(digest)).slice(0, 12)
    .map((b) => b.toString(16).padStart(2, '0')).join('');
};

const buildPrompt = (listing: Record<string, unknown>, prefs: Record<string, unknown> | null) =>
  `You are Hausto's senior rental advisor for expats moving to Vietnam. You are looking at the photos of one apartment and writing an honest read for one specific renter.

Your value is candour. A listing already tells them what's good; you are the one who says what's wrong with it. Read the PHOTOS, not the marketing copy - notice low ceilings, no natural light, a bedroom with no window, a kitchen with no counter space, worn fittings, a view into the neighbouring block, furniture that hides an awkward layout, photos taken so wide the room reads bigger than it is. If a room is missing from the photos entirely, say so - that usually means something.

Never invent facts you cannot see or that aren't in the listing data. If you cannot judge something (noise, water pressure, lift reliability, the actual building lobby), say it's worth checking at the viewing rather than guessing.

For commute: you do NOT know where this renter works. Rate how well the location connects to the districts they said they want and to the central business areas, and say plainly that a real commute rating needs their workplace.

Write plain conversational text. No markdown - no **bold**, no ### headings, no tables. Use "-" not em dashes. Address the renter as "you".

Reply with JSON only, shaped exactly:
{
  "design": "2-4 sentences on the layout, light, finish quality and what the photos actually show",
  "lifestyle_fit": "2-4 sentences on who this place suits and who it doesn't, weighed against this renter's stated preferences",
  "downsides": ["3-5 specific honest downsides read from the photos or the data, each one sentence"],
  "neighbourhood": {"rating": 1-5, "note": "1-2 sentences on the area against what they said they want"},
  "commute": {"rating": 1-5, "note": "1-2 sentences, stating the workplace caveat"},
  "worth_viewing": "one sentence - is this worth their time, and what to ask if they go"
}
Ratings are integers 1-5, where 3 is ordinary. Do not give everything a 4.

Listing data:
${JSON.stringify(listing, null, 1)}

${prefs ? `This renter's stated preferences:\n${JSON.stringify(prefs, null, 1)}` : 'This renter has not set preferences yet - write the read generally and say that setting preferences would sharpen it.'}`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");
    const { data: userData, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userError) throw new Error(`Authentication error: ${userError.message}`);
    const user = userData.user;
    if (!user) throw new Error("User not authenticated");

    const body = await req.json().catch(() => ({}));
    const propertyId = String(body?.propertyId ?? '');
    const propertyType = body?.propertyType === 'external' ? 'external' : 'internal';
    if (!propertyId) throw new Error("propertyId is required");

    // The renter's preferences decide both the answer and the cache key, so
    // they're read before anything else.
    const { data: prefs } = await supabase
      .from('user_preferences')
      .select('styles, activities, must_haves, price_range_min, price_range_max, size, location, move_in_date')
      .eq('user_id', user.id)
      .maybeSingle();
    const fp = await fingerprint(prefs ?? null);

    // Cache first: a read already paid for is served whether or not the pass
    // that paid for it is still live.
    const { data: cached } = await supabase
      .from('listing_deep_analyses')
      .select('analysis, created_at')
      .eq('renter_id', user.id)
      .eq('property_id', propertyId)
      .eq('property_type', propertyType)
      .eq('preference_fingerprint', fp)
      .maybeSingle();
    if (cached) {
      logStep("Cache hit", { propertyId, fp });
      return new Response(
        JSON.stringify({ analysis: cached.analysis, cached: true, generatedAt: cached.created_at }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    // Generating is what the pass buys. Reading what you already have is not.
    const { data: hasPass, error: passError } = await supabase
      .rpc('has_active_pass', { _user_id: user.id });
    if (passError) throw passError;
    if (!hasPass) {
      return new Response(
        JSON.stringify({ error: 'PASS_REQUIRED' }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 402 },
      );
    }

    const table = propertyType === 'external' ? 'external_properties' : 'properties';
    const { data: listing, error: listingError } = await supabase
      .from(table)
      .select('id, title, location, price, rooms, size, vibe, description, highlights, amenities, images')
      .eq('id', propertyId)
      .maybeSingle();
    if (listingError) throw listingError;
    if (!listing) throw new Error("Listing not found");

    const images: string[] = (listing.images ?? []).filter((u: unknown) => typeof u === 'string').slice(0, MAX_IMAGES);
    if (images.length === 0) {
      return new Response(
        JSON.stringify({ error: 'NO_IMAGES' }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 422 },
      );
    }

    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) throw new Error("OpenAI API key not configured");
    if (await isOpenAIBudgetExhausted()) {
      return new Response(
        JSON.stringify({ error: 'BUDGET_EXHAUSTED' }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 429 },
      );
    }

    // The images are the point - the prompt says to read them rather than the
    // marketing copy, so the copy is passed as context only.
    const { images: _drop, ...listingData } = listing as Record<string, unknown>;
    logStep("Generating", { propertyId, propertyType, images: images.length });

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 900,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: buildPrompt(listingData, prefs ?? null) },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Here are the listing photos. Write the read.' },
              ...images.map((url) => ({ type: 'image_url', image_url: { url, detail: 'low' } })),
            ],
          },
        ],
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      console.error('[deep-vibe-analysis] OpenAI error:', resp.status, detail.slice(0, 300));
      throw new Error(`AI request failed (${resp.status})`);
    }

    const data = await resp.json();
    logOpenAIUsage({ fn: 'deep-vibe-analysis', model: MODEL, usage: data?.usage });

    let analysis: Record<string, unknown>;
    try {
      analysis = JSON.parse(data.choices?.[0]?.message?.content?.trim() || '{}');
    } catch {
      console.error('[deep-vibe-analysis] Non-JSON reply');
      throw new Error("The analysis came back malformed - please try again");
    }
    if (!analysis?.design && !analysis?.lifestyle_fit) {
      throw new Error("The analysis came back empty - please try again");
    }

    // Storing is best-effort: the renter gets their read either way, and a
    // failed cache write only costs a regeneration.
    const { error: insertError } = await supabase.from('listing_deep_analyses').insert({
      renter_id: user.id,
      property_id: propertyId,
      property_type: propertyType,
      preference_fingerprint: fp,
      analysis,
    });
    if (insertError && !String(insertError.message).includes('duplicate')) {
      console.error('[deep-vibe-analysis] Cache write failed:', insertError.message);
    }

    return new Response(
      JSON.stringify({ analysis, cached: false, generatedAt: new Date().toISOString() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
