import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { analyzeImagesQualityFirst } from "./shared.ts";
import { MIN_DISPLAY_IMAGES, ANALYZE_COUNT, expectedHighlightCount, highlightPolicyOf } from "../_shared/vibe-policy.ts";
import { isOpenAIBudgetExhausted } from "../_shared/openai-usage.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Listing-quality rules come from _shared/vibe-policy.ts — the same module
// process-vibe-queue writes against, so "how many highlights we produce" and
// "how many highlights we require" can never drift apart again.

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

    const { limit = 10, property_ids, requeue_only = false, missing_only = true } = await req.json().catch(() => ({}));

    // Selection: only listings whose image highlights are actually missing or broken.
    // A listing is considered "missing highlights" when:
    //   - it has images, AND
    //   - highlights array is empty/shorter than images, OR
    //   - vibe_analysis.image_analyses is missing/empty/poisoned (rate-limit error strings, blank highlight)
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

    // A listing whose images are permanently unfetchable is done as far as this
    // job is concerned — chasing it costs money on every run and can never
    // succeed. Re-crawling replaces `images` and clears the flag; passing
    // explicit property_ids with missing_only=false forces a retry anyway.
    const isUnfixable = (p: any): boolean => p.vibe_analysis?.image_backfill?.unfixable === true;

    const hasMissingHighlights = (p: any): boolean => {
      const images = Array.isArray(p.images) ? p.images : [];
      if (images.length === 0) return false; // nothing to analyze
      if (isUnfixable(p)) return false;
      const highlights = Array.isArray(p.highlights) ? p.highlights.filter((h: any) => typeof h === 'string' && h.trim()) : [];
      // Judged against the policy this listing was analysed under, not the
      // current one: a listing finished when the target was 5 is still finished,
      // so raising the target does not drag the whole catalogue back through
      // vision. Listings holding fewer photos than the target are likewise done
      // at one highlight per image - they can never reach it, and requiring it
      // would re-analyze them on every run and never converge.
      const expected = expectedHighlightCount(images.length, highlightPolicyOf(p.vibe_analysis));
      if (highlights.length < expected) return true;
      return isPoisoned(p);
    };

    if (Array.isArray(property_ids) && property_ids.length > 0) {
      const { data, error } = await supabase
        .from('external_properties')
        .select('id, title, images, vibe_analysis, vibe_status, highlights')
        .in('id', property_ids);
      if (error) throw error;
      needsBackfill = (data || []).filter((p) =>
        Array.isArray(p.images) && p.images.length > 0 &&
        (missing_only ? hasMissingHighlights(p) : (p.vibe_status !== 'complete' || isPoisoned(p)))
      );
    } else {
      // Fetch a wider candidate pool then filter to truly-missing-highlights only.
      // We page through in chunks to avoid the 1000-row Supabase cap when scanning broadly.
      const candidates: any[] = [];
      const pageSize = 1000;
      let from = 0;
      const maxScan = 5000; // safety cap
      while (candidates.length < limit && from < maxScan) {
        const { data, error } = await supabase
          .from('external_properties')
          .select('id, title, images, vibe_analysis, vibe_status, highlights, created_at')
          .order('created_at', { ascending: false })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const p of data) {
          if (missing_only ? hasMissingHighlights(p) : (p.vibe_status !== 'complete' && Array.isArray(p.images) && p.images.length > 0)) {
            candidates.push(p);
            if (candidates.length >= limit) break;
          }
        }
        if (data.length < pageSize) break;
        from += pageSize;
      }
      needsBackfill = candidates;
    }

    console.log(`[backfill] ${needsBackfill.length} properties need vibe analysis`);

    // Requeue mode: only mark as pending and enqueue, don't process here.
    if (requeue_only) {
      let enqueued = 0;
      let skippedBelowFloor = 0;
      for (const prop of needsBackfill) {
        // The vibe queue enforces MIN_DISPLAY_IMAGES and fails anything under
        // it, so enqueueing a sub-floor legacy listing only burns attempts and
        // hides it. Those are handled inline by a non-requeue run instead.
        const imageCount = Array.isArray(prop.images) ? prop.images.length : 0;
        if (imageCount < MIN_DISPLAY_IMAGES) {
          skippedBelowFloor++;
          continue;
        }
        await supabase
          .from('external_properties')
          .update({ vibe_status: 'pending', is_active: false, updated_at: new Date().toISOString() })
          .eq('id', prop.id);
        const { error: qErr } = await supabase
          .from('vibe_analysis_queue')
          .insert({ property_id: prop.id, status: 'queued' });
        if (!qErr || qErr.code === '23505') enqueued++;
      }
      return new Response(JSON.stringify({ success: true, enqueued, skippedBelowFloor, total: needsBackfill.length }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (needsBackfill.length > 0 && await isOpenAIBudgetExhausted()) {
      return new Response(
        JSON.stringify({ success: false, error: 'daily OpenAI budget reached', total: needsBackfill.length }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const results: any[] = [];
    for (const prop of needsBackfill) {
      try {
        const allImages = Array.isArray(prop.images) ? prop.images : [];
        if (allImages.length === 0) {
          results.push({ id: prop.id, title: prop.title, success: false, reason: 'no_images' });
          continue;
        }

        // Only listings that clear the display floor are eligible to go live.
        // Legacy listings below it can never reach it, so we analyze every image
        // they do have and leave their live/hidden state exactly as found —
        // deactivating them and routing them to the vibe queue only produced
        // guaranteed insufficient_quality_images failures.
        const meetsDisplayFloor = allImages.length >= MIN_DISPLAY_IMAGES;

        // Hand over the whole gallery with a target: the analyzer stops at
        // expectedHighlightCount successes, so a dead image is replaced by the
        // next one down rather than failing the listing.
        const target = expectedHighlightCount(allImages.length);
        const result = await analyzeImagesQualityFirst({
          imageUrls: allImages,
          openaiKey,
          targetCount: target,
        });

        if (!result.allSucceeded) {
          // Every image has now been tried and the shortfall is dead source
          // URLs rather than a transient API problem, so this listing can never
          // reach `target`. Keep the highlights we did get and stop selecting
          // it — otherwise it is re-analyzed on every run forever, paying for
          // the images that still work and never converging.
          const exhausted = result.analyses.length + result.failures.length >= allImages.length;
          const onlyDeadImages = result.failures.length > 0 &&
            result.failures.every((f) => f.reason === 'fetch_failed');

          if (exhausted && onlyDeadImages) {
            const partialHighlights = result.analyses
              .map((a) => String(a.image_highlight || '').trim())
              .filter(Boolean);
            await supabase
              .from('external_properties')
              .update({
                vibe_analysis: {
                  ...(prop.vibe_analysis || {}),
                  image_analyses: result.analyses,
                  highlight_policy: ANALYZE_COUNT,
                  image_backfill: {
                    unfixable: true,
                    reason: 'images_unfetchable',
                    analyzed: result.analyses.length,
                    expected: target,
                    at: new Date().toISOString(),
                  },
                },
                highlights: partialHighlights,
                updated_at: new Date().toISOString(),
              })
              .eq('id', prop.id);
            results.push({
              id: prop.id, title: prop.title, success: false,
              reason: 'images_unfetchable_giving_up',
              analyzed: result.analyses.length, expected: target,
            });
            continue;
          }

          // Quality-first: leave as pending, enqueue for retry. NO fake highlights.
          // Hiding on failure applies only to listings that could go live on the
          // strength of their gallery; a sub-floor legacy listing keeps whatever
          // state it already had.
          await supabase
            .from('external_properties')
            .update({
              vibe_status: 'pending',
              ...(meetsDisplayFloor ? { is_active: false } : {}),
              updated_at: new Date().toISOString(),
            })
            .eq('id', prop.id);
          if (meetsDisplayFloor) {
            await supabase
              .from('vibe_analysis_queue')
              .insert({ property_id: prop.id, status: 'queued', last_error: JSON.stringify(result.failures).substring(0, 500) })
              .then(() => {}, () => {});
          }
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

        // Success clears any earlier give-up marker — a re-crawl may have
        // replaced the dead images.
        const { image_backfill: _cleared, ...priorVibe } = (prop.vibe_analysis || {});
        const updatedVibe = {
          ...priorVibe,
          image_analyses: analyses,
          amenities: Array.from(allAmenities),
          highlight_policy: ANALYZE_COUNT,
        };

        const { error: updateErr } = await supabase
          .from('external_properties')
          .update({
            vibe_analysis: updatedVibe,
            highlights: positionalHighlights,
            vibe_status: 'complete',
            ...(meetsDisplayFloor ? { is_active: true } : {}),
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
