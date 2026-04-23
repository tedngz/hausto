// Scheduled consumer for the vibe_analysis_queue table.
// Pulls a small batch, runs per-image analysis with TPM throttling, and
// either marks the listing as vibe_status='complete' + is_active=true,
// or requeues for another attempt. Listings stay hidden from discovery
// until they pass full vision QC.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { analyzeImagesQualityFirst } from "./shared.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_ATTEMPTS = 5;
const DEFAULT_BATCH = 4;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) {
      return new Response(JSON.stringify({ error: 'OPENAI_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { batchSize = DEFAULT_BATCH } = await req.json().catch(() => ({}));

    // Atomically claim a batch by flipping status queued → processing
    const { data: queued } = await supabase
      .from('vibe_analysis_queue')
      .select('id, property_id, attempts')
      .eq('status', 'queued')
      .order('enqueued_at', { ascending: true })
      .limit(batchSize);

    if (!queued || queued.length === 0) {
      return new Response(JSON.stringify({ success: true, processed: 0, message: 'queue empty' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const claimedIds = queued.map((q: any) => q.id);
    await supabase
      .from('vibe_analysis_queue')
      .update({ status: 'processing' })
      .in('id', claimedIds);

    const results: any[] = [];

    for (const job of queued) {
      try {
        const { data: prop } = await supabase
          .from('external_properties')
          .select('id, title, images, vibe_analysis')
          .eq('id', job.property_id)
          .maybeSingle();

        if (!prop || !Array.isArray(prop.images) || prop.images.length === 0) {
          await supabase
            .from('vibe_analysis_queue')
            .update({ status: 'failed', last_error: 'property_not_found_or_no_images' })
            .eq('id', job.id);
          results.push({ jobId: job.id, ok: false, reason: 'no_property' });
          continue;
        }

        const images = prop.images.slice(0, 5);
        const result = await analyzeImagesQualityFirst({ imageUrls: images, openaiKey });

        if (!result.allSucceeded) {
          const newAttempts = (job.attempts || 0) + 1;
          const lastError = JSON.stringify(result.failures).substring(0, 500);
          if (newAttempts >= MAX_ATTEMPTS) {
            await supabase
              .from('vibe_analysis_queue')
              .update({ status: 'failed', attempts: newAttempts, last_error: lastError })
              .eq('id', job.id);
            results.push({ jobId: job.id, propertyId: prop.id, ok: false, reason: 'max_attempts', failures: result.failures });
          } else {
            // Requeue
            await supabase
              .from('vibe_analysis_queue')
              .update({ status: 'queued', attempts: newAttempts, last_error: lastError })
              .eq('id', job.id);
            results.push({ jobId: job.id, propertyId: prop.id, ok: false, reason: 'requeued', attempts: newAttempts });
          }
          continue;
        }

        const analyses = result.analyses;
        const positionalHighlights = analyses
          .map(a => String(a.image_highlight || '').trim())
          .filter(Boolean);

        const allAmenities = new Set<string>();
        analyses.forEach(a => {
          if (Array.isArray(a.amenities)) a.amenities.forEach((x: string) => allAmenities.add(x));
        });

        const avg = (k: string) =>
          Math.round(analyses.reduce((s, a) => s + (Number(a[k]) || 5), 0) / analyses.length);

        const aggregated = {
          ...(prop.vibe_analysis || {}),
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

        const { error: updErr } = await supabase
          .from('external_properties')
          .update({
            vibe_analysis: aggregated,
            highlights: positionalHighlights,
            vibe_status: 'complete',
            is_active: true,
            updated_at: new Date().toISOString(),
          })
          .eq('id', prop.id);

        if (updErr) {
          await supabase
            .from('vibe_analysis_queue')
            .update({ status: 'queued', attempts: (job.attempts || 0) + 1, last_error: updErr.message })
            .eq('id', job.id);
          results.push({ jobId: job.id, propertyId: prop.id, ok: false, reason: 'db_update_failed' });
        } else {
          await supabase
            .from('vibe_analysis_queue')
            .update({ status: 'complete', attempts: (job.attempts || 0) + 1 })
            .eq('id', job.id);
          results.push({ jobId: job.id, propertyId: prop.id, ok: true, highlights: positionalHighlights.length });
        }
      } catch (e) {
        console.error('[process-vibe-queue] job error:', e);
        await supabase
          .from('vibe_analysis_queue')
          .update({ status: 'queued', attempts: (job.attempts || 0) + 1, last_error: String(e).substring(0, 500) })
          .eq('id', job.id);
        results.push({ jobId: job.id, ok: false, reason: 'exception' });
      }
    }

    const ok = results.filter(r => r.ok).length;
    return new Response(JSON.stringify({ success: true, processed: results.length, completed: ok, results }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[process-vibe-queue] fatal:', e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
