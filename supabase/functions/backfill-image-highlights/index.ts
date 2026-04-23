import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { analyzeImagesQualityFirst } from "../analyze-vibe/shared.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiKey = Deno.env.get('OPENAI_API_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Auth: accept anon apikey or service-role token
    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization') || '';
    const apikey = req.headers.get('apikey') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';

    const hasValidApikey = apikey === anonKey;
    const isServiceRole = token === serviceKey;

    if (!hasValidApikey && !isServiceRole) {
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

    const { limit = 10, property_ids, requeue_only = false } = await req.json().catch(() => ({}));

    // Selection: any external_properties row with images that is NOT vibe_status='complete'
    // OR has rate-limit-poisoned strings in detailed_analysis from a previous failure.
    let needsBackfill: any[] = [];

    const isPoisoned = (p: any): boolean => {
      const va = p.vibe_analysis;
      const analyses = Array.isArray(va?.image_analyses) ? va.image_analyses : [];
      if (analyses.length === 0) return true;
      return analyses.some((a: any) => {
        const hl = String(a?.image_highlight || '').trim();
        const detail = String(a?.detailed_analysis || '');
        return !hl || /rate.?limit|api error|rate_limit_exceeded|analysis failed/i.test(detail);
      });
    };

    if (Array.isArray(property_ids) && property_ids.length > 0) {
      const { data, error } = await supabase
        .from('external_properties')
        .select('id, title, images, vibe_analysis, vibe_status, highlights')
        .in('id', property_ids);
      if (error) throw error;
      needsBackfill = (data || []).filter((p) =>
        Array.isArray(p.images) && p.images.length > 0 &&
        (p.vibe_status !== 'complete' || isPoisoned(p))
      );
    } else {
      const { data, error } = await supabase
        .from('external_properties')
        .select('id, title, images, vibe_analysis, vibe_status, highlights')
        .neq('vibe_status', 'complete')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      needsBackfill = (data || []).filter((p) => Array.isArray(p.images) && p.images.length > 0);
    }

    console.log(`[backfill] ${needsBackfill.length} properties need vibe analysis`);

    // Requeue mode: only mark as pending and enqueue, don't process here.
    if (requeue_only) {
      let enqueued = 0;
      for (const prop of needsBackfill) {
        await supabase
          .from('external_properties')
          .update({ vibe_status: 'pending', is_active: false, updated_at: new Date().toISOString() })
          .eq('id', prop.id);
        const { error: qErr } = await supabase
          .from('vibe_analysis_queue')
          .insert({ property_id: prop.id, status: 'queued' });
        if (!qErr || qErr.code === '23505') enqueued++;
      }
      return new Response(JSON.stringify({ success: true, enqueued, total: needsBackfill.length }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results: any[] = [];
    for (const prop of needsBackfill) {
      try {
        const images = (prop.images || []).slice(0, 5);
        const result = await analyzeImagesQualityFirst({ imageUrls: images, openaiKey });

        if (!result.allSucceeded) {
          // Quality-first: leave as pending, enqueue for retry. NO fake highlights.
          await supabase
            .from('external_properties')
            .update({
              vibe_status: 'pending',
              is_active: false,
              updated_at: new Date().toISOString(),
            })
            .eq('id', prop.id);
          await supabase
            .from('vibe_analysis_queue')
            .insert({ property_id: prop.id, status: 'queued', last_error: JSON.stringify(result.failures).substring(0, 500) })
            .then(() => {}, () => {});
          results.push({
            id: prop.id, title: prop.title, success: false,
            reason: 'partial_failure_requeued',
            failures: result.failures,
          });
          continue;
        }

        const analyses = result.analyses;
        const positionalHighlights = analyses
          .map((a) => String(a.image_highlight || '').trim())
          .filter(Boolean);

        const allAmenities = new Set<string>();
        analyses.forEach((a) => {
          if (Array.isArray(a.amenities)) a.amenities.forEach((x: string) => allAmenities.add(x));
        });

        const updatedVibe = {
          ...(prop.vibe_analysis || {}),
          image_analyses: analyses,
          amenities: Array.from(allAmenities),
        };

        const { error: updateErr } = await supabase
          .from('external_properties')
          .update({
            vibe_analysis: updatedVibe,
            highlights: positionalHighlights,
            vibe_status: 'complete',
            is_active: true,
            updated_at: new Date().toISOString(),
          })
          .eq('id', prop.id);

        if (updateErr) {
          results.push({ id: prop.id, title: prop.title, success: false, error: updateErr.message });
        } else {
          console.log(`[backfill] ✓ ${prop.id}: ${analyses.length} highlights`);
          results.push({ id: prop.id, title: prop.title, success: true, highlightCount: analyses.length });
        }
      } catch (e) {
        results.push({ id: prop.id, title: prop.title, success: false, error: String(e) });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    console.log(`[backfill] Done: ${successCount}/${results.length}`);

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
