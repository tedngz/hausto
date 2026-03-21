import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const capitalize = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

async function analyzeImages(images: string[], openaiKey: string): Promise<any[] | null> {
  const imageContent = [];
  const validIndexes: number[] = [];

  for (let i = 0; i < Math.min(images.length, 5); i++) {
    try {
      const resp = await fetch(images[i]);
      if (!resp.ok) continue;
      const ct = resp.headers.get('content-type') || '';
      const buf = await resp.arrayBuffer();
      const bytes = new Uint8Array(buf);
      if (bytes.length > 5 * 1024 * 1024) continue;

      let b64 = '';
      const chunk = 8192;
      for (let j = 0; j < bytes.length; j += chunk) {
        b64 += String.fromCharCode.apply(null, Array.from(bytes.subarray(j, Math.min(j + chunk, bytes.length))));
      }

      let mime = 'image/jpeg';
      if (ct.includes('png')) mime = 'image/png';
      else if (ct.includes('webp')) mime = 'image/webp';

      imageContent.push({
        type: 'image_url',
        image_url: { url: `data:${mime};base64,${btoa(b64)}`, detail: 'low' }
      });
      validIndexes.push(i);
    } catch {
      continue;
    }
  }

  if (imageContent.length === 0) return null;

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Analyze these ${imageContent.length} rental property images. For EACH image, provide a unique lifestyle highlight specific to what you SEE in that image.

Return ONLY valid JSON with this structure:
{
  "image_analyses": [
    {"image_index": 0, "image_highlight": "Specific highlight about THIS image (7-12 words)", "suggested_amenities": ["Amenity1"]},
    {"image_index": 1, "image_highlight": "Specific highlight about THIS image (7-12 words)", "suggested_amenities": ["Amenity1"]}
  ]
}

Rules:
- Each image_highlight MUST describe what is VISIBLE in that specific image
- NO generic descriptions like "modern living space" or "fully furnished apartment"
- Be specific: mention visible furniture, views, materials, colors, layout features
- Each highlight must be DIFFERENT from the others`
          },
          ...imageContent,
        ]
      }],
      max_tokens: 800,
      temperature: 0.3,
    }),
  });

  if (!resp.ok) {
    console.error('[backfill] OpenAI error:', await resp.text());
    return null;
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || '';
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  const parsed = JSON.parse(jsonMatch[0]);
  const analyses = Array.isArray(parsed.image_analyses) ? parsed.image_analyses : [];

  // Map back to original indexes
  return analyses.map((ia: any, idx: number) => ({
    ...ia,
    image_index: validIndexes[idx] ?? idx,
    image_highlight: ia.image_highlight ? capitalize(String(ia.image_highlight)) : '',
    suggested_amenities: Array.isArray(ia.suggested_amenities) ? ia.suggested_amenities : [],
  }));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiKey = Deno.env.get('OPENAI_API_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Auth check - accept any valid auth (service role key is used for DB access)
    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization') || '';
    const apikey = req.headers.get('apikey') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    
    console.log(`[backfill] Auth: token length=${token.length}, apikey length=${apikey.length}, anonKey length=${anonKey.length}`);
    
    // Accept if apikey matches anon key (standard Supabase invocation) or token is service key
    const hasValidApikey = apikey === anonKey;
    const isServiceRole = token === serviceKey;
    
    if (!hasValidApikey && !isServiceRole) {
      // Try JWT verification
      if (!token) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: { user } } = await supabase.auth.getUser(token);
      if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const { limit = 10 } = await req.json().catch(() => ({}));

    // Find external properties with empty image_analyses
    const { data: properties, error } = await supabase
      .from('external_properties')
      .select('id, title, images, vibe_analysis, highlights')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    // Filter to those actually missing image_analyses
    const needsBackfill = (properties || []).filter((p: any) => {
      const analyses = p.vibe_analysis?.image_analyses;
      return !analyses || !Array.isArray(analyses) || analyses.length === 0;
    }).filter((p: any) => p.images && p.images.length > 0);

    console.log(`[backfill] Found ${needsBackfill.length} properties needing image highlights`);

    const results = [];
    for (const prop of needsBackfill) {
      try {
        console.log(`[backfill] Analyzing: ${prop.id} - ${prop.title}`);
        const analyses = await analyzeImages(prop.images, openaiKey);

        if (!analyses || analyses.length === 0) {
          results.push({ id: prop.id, title: prop.title, success: false, error: 'No analyses returned' });
          continue;
        }

        // Build per-image highlights array
        const perImageHighlights = prop.images.map((_: any, idx: number) => {
          const a = analyses.find((ia: any) => ia.image_index === idx);
          return a?.image_highlight || '';
        }).filter(Boolean);

        // Merge into existing vibe_analysis
        const updatedVibe = {
          ...(prop.vibe_analysis || {}),
          image_analyses: analyses,
        };

        const { error: updateErr } = await supabase
          .from('external_properties')
          .update({
            vibe_analysis: updatedVibe,
            highlights: perImageHighlights.length > 0 ? perImageHighlights : prop.highlights,
            updated_at: new Date().toISOString(),
          })
          .eq('id', prop.id);

        if (updateErr) {
          results.push({ id: prop.id, title: prop.title, success: false, error: updateErr.message });
        } else {
          console.log(`[backfill] ✓ ${prop.id}: ${analyses.length} image highlights generated`);
          results.push({ id: prop.id, title: prop.title, success: true, highlightCount: analyses.length });
        }
      } catch (e) {
        results.push({ id: prop.id, title: prop.title, success: false, error: String(e) });
      }
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`[backfill] Done: ${successCount}/${results.length} succeeded`);

    return new Response(JSON.stringify({
      success: true,
      total: needsBackfill.length,
      successCount,
      results,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[backfill] Error:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
