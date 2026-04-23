import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { analyzeImagesQualityFirst } from "./shared.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401,
      });
    }

    const token = authHeader.replace(/^Bearer\s+/i, '');
    let userId = 'unknown';
    try {
      const base64 = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/');
      if (base64) {
        const payload = JSON.parse(atob(base64));
        userId = payload.sub || payload.user_id || userId;
      }
    } catch (_) { /* ignore */ }

    const { imageUrls, propertyId, propertyInfo } = await req.json();
    console.log('[analyze-vibe] User:', userId, 'images:', imageUrls?.length, 'propertyId:', propertyId);

    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiApiKey) {
      return new Response(JSON.stringify({ error: 'OpenAI API key not configured' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
      });
    }

    if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
      return new Response(JSON.stringify({ error: 'No images provided for analysis' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
      });
    }

    const result = await analyzeImagesQualityFirst({
      imageUrls,
      openaiKey: openaiApiKey,
      propertyInfo,
    });

    if (!result.allSucceeded) {
      // Quality-first: if ANY image failed, surface failure to caller.
      // Caller (queue consumer / admin tool) decides whether to mark
      // vibe_status=complete or leave it pending for retry.
      return new Response(JSON.stringify({
        success: false,
        analyses: result.analyses,
        failures: result.failures,
        message: 'One or more images failed analysis (rate limit / parse / fetch). Caller should retry.',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
      });
    }

    // Build aggregated payload mirroring legacy shape
    const analyses = result.analyses;
    const allAmenities = new Set<string>();
    analyses.forEach(a => {
      if (Array.isArray(a.amenities)) a.amenities.forEach((x: string) => allAmenities.add(x));
      if (Array.isArray(a.suggested_amenities)) a.suggested_amenities.forEach((x: string) => allAmenities.add(x));
    });

    const avg = (key: string) =>
      Math.round(analyses.reduce((s, a) => s + (Number(a[key]) || 5), 0) / analyses.length);

    const aggregated: any = {
      modern: avg('modern'),
      cozy: avg('cozy'),
      luxurious: avg('luxurious'),
      minimalist: avg('minimalist'),
      colorful: avg('colorful'),
      spacious: avg('spacious'),
      natural_light: avg('natural_light'),
      urban: avg('urban'),
      rustic: avg('rustic'),
      elegant: avg('elegant'),
      amenities: Array.from(allAmenities),
      image_analyses: analyses,
    };

    // If a propertyId was provided, persist directly and mark vibe_status=complete
    if (propertyId) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );
      const positionalHighlights = analyses
        .map(a => String(a.image_highlight || '').trim())
        .filter(Boolean);

      const { error: updateErr } = await supabase
        .from('external_properties')
        .update({
          vibe_analysis: aggregated,
          highlights: positionalHighlights,
          vibe_status: 'complete',
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', propertyId);

      if (updateErr) {
        console.error('[analyze-vibe] DB update failed:', updateErr);
        return new Response(JSON.stringify({
          success: false, error: updateErr.message, analyses,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
        });
      }
    }

    return new Response(JSON.stringify({ success: true, analysis: aggregated }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
    });

  } catch (error) {
    console.error('[analyze-vibe] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
    });
  }
});
