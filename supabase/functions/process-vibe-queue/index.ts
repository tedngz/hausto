// Scheduled consumer for the vibe_analysis_queue table.
// Pulls a small batch, runs per-image analysis with TPM throttling, and
// either marks the listing as vibe_status='complete' + is_active=true,
// or requeues for another attempt. Listings stay hidden from discovery
// until they pass full vision QC.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { analyzeImagesQualityFirst } from "./shared.ts";
import { dHashFromBytes } from "../_shared/dhash.ts";
import {
  MIN_DISPLAY_IMAGES, STORE_TARGET, expectedHighlightCount,
  interiorMajority, isVideoOrAnimatedUrl, isMapOrDiagramUrl, isCredibleMapLabel,
  isAnimatedOrVideoBytes,
} from "../_shared/vibe-policy.ts";
import { isOpenAIBudgetExhausted } from "../_shared/openai-usage.ts";
import { prepareForStorage } from "../_shared/mirror-image.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_ATTEMPTS = 5;
const DEFAULT_BATCH = 4;
const MIRROR_BUCKET = 'external-property-images';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
// Mirrored photos never change in place except on a re-mirror, so a long CDN
// TTL turns repeat views into cache hits instead of metered origin egress.
const MIRROR_CACHE_CONTROL = '604800'; // 7 days
// Hashes are computed for the first few photos only - enough for the dedupe
// pass to match a unit, and it keeps decode cost bounded.
const HASH_COUNT = 3;

// ─── Listing-quality rules for crawled external properties ───────
// Show at least MIN_DISPLAY_IMAGES real photos of the unit, keep up to
// STORE_TARGET, and analyze every qualified image up to ANALYZE_COUNT.
// Defined in _shared/vibe-policy.ts so the backfill's "still missing
// highlights?" check derives from the same numbers this function writes.
// Tiny source thumbnails render blurry when shown large; drop anything
// narrower than this before it ever reaches the gallery.
const MIN_IMAGE_WIDTH = 600;

async function safeFolder(externalId: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(externalId));
  const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  const readable = externalId.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
  return `${readable}-${hex.substring(0, 16)}`;
}

// Parse pixel width from JPEG SOF / PNG IHDR headers so we can reject tiny
// source thumbnails before they reach the gallery (webp/unknown → don't block).
function imageWidth(bytes: Uint8Array): number | null {
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xd8) { // JPEG
      let i = 2;
      while (i < bytes.length - 9) {
        if (bytes[i] !== 0xff) { i++; continue; }
        const marker = bytes[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return (bytes[i + 7] << 8) | bytes[i + 8];
        }
        i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
      }
      return null;
    }
    if (bytes[0] === 0x89 && bytes[1] === 0x50) { // PNG
      return (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
    }
    return null;
  } catch {
    return null;
  }
}

// Fetch each candidate once, drop non-image / too-large / low-res shots, mirror
// the survivors to storage, and stop at `target`. Returns the mirrored public
// URLs alongside the source URLs they came from (kept in order for recovery),
// plus the perceptual hashes of the first HASH_COUNT survivors - computed here
// from the bytes we already hold rather than by re-downloading them later.
async function mirrorQualityImages(
  supabase: any, urls: string[], externalId: string, target: number,
): Promise<{ mirrored: string[]; originals: string[]; hashes: string[] }> {
  const mirrored: string[] = [];
  const originals: string[] = [];
  const hashes: string[] = [];
  const folder = await safeFolder(externalId);
  for (const url of urls) {
    if (mirrored.length >= target) break;
    if (!url) continue;
    // Applies the current rules to older rows too, whose images were stored
    // before videos, gifs and maps were filtered at crawl time.
    if (isVideoOrAnimatedUrl(url) || isMapOrDiagramUrl(url)) continue;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 HaustoBot' } });
      clearTimeout(t);
      if (!res.ok) continue;
      const ct = (res.headers.get('content-type') || 'image/jpeg').toLowerCase();
      if (!ct.startsWith('image/') || ct.includes('gif')) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) continue;
      // Video / animated payload behind an image content-type
      if (isAnimatedOrVideoBytes(bytes)) continue;
      // Low-quality guard: reject tiny source thumbnails. Runs on the original
      // bytes, before any downscale, so the dimension check is honest.
      const w = imageWidth(bytes);
      if (w !== null && w < MIN_IMAGE_WIDTH) continue;
      // Cap resolution and re-encode before storing so repeat views stay light.
      const prepared = await prepareForStorage(bytes, ct);
      const path = `${folder}/${mirrored.length}.${prepared.ext}`;
      const { error } = await supabase.storage.from(MIRROR_BUCKET)
        .upload(path, prepared.bytes, { contentType: prepared.contentType, upsert: true, cacheControl: MIRROR_CACHE_CONTROL });
      if (error) { console.warn('[mirror] upload failed:', error.message); continue; }
      const { data } = supabase.storage.from(MIRROR_BUCKET).getPublicUrl(path);
      if (data?.publicUrl) {
        if (hashes.length < HASH_COUNT) {
          const h = await dHashFromBytes(prepared.bytes);
          if (h) hashes.push(h);
        }
        mirrored.push(data.publicUrl);
        originals.push(url);
      }
    } catch (e) {
      console.warn('[mirror] error:', String(e).substring(0, 200));
    }
  }
  return { mirrored, originals, hashes };
}

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

    // Spend guard. Checked before claiming anything: a batch that is claimed
    // and then abandoned leaves rows stranded in 'processing', which the
    // queued-only claim query never picks up again. Jobs simply stay queued
    // and resume once the daily cap rolls over.
    if (await isOpenAIBudgetExhausted()) {
      console.warn('[process-vibe-queue] daily OpenAI budget reached — leaving batch queued');
      return new Response(
        JSON.stringify({ success: true, processed: 0, message: 'daily OpenAI budget reached' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
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
          .select('id, title, images, vibe_analysis, external_id, source, raw_data, raw_only')
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

        // 1) Build the display set first: dimension-filtered + mirrored, capped
        //    at STORE_TARGET. This is exactly what renters see in the gallery.
        const mirrorKey = `${prop.source || 'src'}-${prop.external_id || prop.id}`;
        const candidates = [...new Set(prop.images as string[])];
        let { mirrored: displayImages, originals: keptOriginals, hashes: imageHashes } =
          await mirrorQualityImages(supabase, candidates, mirrorKey, STORE_TARGET);

        // Quality floor: a listing must clear MIN_DISPLAY_IMAGES real photos.
        // If it can't, hold it (stays hidden) rather than shipping a thin gallery.
        // This won't fix on retry, so fail the job outright.
        if (displayImages.length < MIN_DISPLAY_IMAGES) {
          // The row never records these mirrors, so drop them rather than
          // leaving bytes in the bucket that nothing will ever link to.
          const strandedPaths = displayImages
            .map(u => u.split(`/${MIRROR_BUCKET}/`)[1])
            .filter(Boolean) as string[];
          if (strandedPaths.length > 0) {
            await supabase.storage.from(MIRROR_BUCKET).remove(strandedPaths).catch(() => {});
          }
          await supabase
            .from('vibe_analysis_queue')
            .update({ status: 'failed', attempts: (job.attempts || 0) + 1, last_error: `insufficient_quality_images:${displayImages.length}` })
            .eq('id', job.id);
          results.push({ jobId: job.id, propertyId: prop.id, ok: false, reason: 'insufficient_quality_images', kept: displayImages.length });
          continue;
        }

        // 2) Analyze every qualified image, capped at ANALYZE_COUNT. The count
        //    written here is what the backfill checks for, so both derive it
        //    from expectedHighlightCount rather than hardcoding a number.
        // Hand over the whole gallery with a target: the analyzer stops at
        // ANALYZE_COUNT successes, so a dead image is replaced by the next one
        // down rather than failing the listing.
        const result = await analyzeImagesQualityFirst({
          imageUrls: displayImages,
          openaiKey,
          targetCount: expectedHighlightCount(displayImages.length),
        });

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

        // 2b) Interior majority. The vision pass labels each analyzed photo
        //     is_interior; outdoor shots that would tie or outnumber the
        //     interiors are dropped from the gallery (and from storage, so we
        //     don't pay to keep bytes nothing links to). Images beyond
        //     ANALYZE_COUNT went through the crawler's interior gate already
        //     and are left alone.
        const interiorFlag = new Map<number, boolean>();
        const mapFlag = new Set<number>();
        for (const a of result.analyses) {
          if (typeof a?.image_index !== 'number') continue;
          interiorFlag.set(a.image_index, a.is_interior !== false);
          if (isCredibleMapLabel(a.is_map_or_diagram === true, String(a.map_evidence || ''))) {
            mapFlag.add(a.image_index);
          }
        }
        // Maps, plans and video frames the vision pass recognised by sight go
        // first - they are not photos of the unit at any ratio.
        const photos = displayImages
          .map((url, i) => ({ url, i, interior: interiorFlag.get(i) ?? true }))
          .filter(x => !mapFlag.has(x.i));
        const labelled = photos;
        const keptIdx = new Set(interiorMajority(labelled, x => x.interior).map(x => x.i));

        if (keptIdx.size === 0 || keptIdx.size < MIN_DISPLAY_IMAGES) {
          const reason = keptIdx.size === 0
            ? 'no_interior_images'
            : `interior_majority_below_floor:${keptIdx.size}`;
          const droppedPaths = displayImages
            .map(u => u.split(`/${MIRROR_BUCKET}/`)[1])
            .filter(Boolean) as string[];
          if (droppedPaths.length > 0) {
            await supabase.storage.from(MIRROR_BUCKET).remove(droppedPaths).catch(() => {});
          }
          await supabase
            .from('vibe_analysis_queue')
            .update({ status: 'failed', attempts: (job.attempts || 0) + 1, last_error: reason })
            .eq('id', job.id);
          results.push({ jobId: job.id, propertyId: prop.id, ok: false, reason });
          continue;
        }

        if (keptIdx.size < displayImages.length) {
          const droppedPaths = displayImages
            .filter((_, i) => !keptIdx.has(i))
            .map(u => u.split(`/${MIRROR_BUCKET}/`)[1])
            .filter(Boolean) as string[];
          console.log(`[process-vibe-queue] ${prop.id}: dropping ${droppedPaths.length} outdoor image(s) to keep interiors in the majority`);
          if (droppedPaths.length > 0) {
            await supabase.storage.from(MIRROR_BUCKET).remove(droppedPaths).catch(() => {});
          }
          // Keep gallery order; re-index the analyses onto the surviving images
          const survivors = labelled.filter(x => keptIdx.has(x.i));
          displayImages = survivors.map(x => x.url);
          keptOriginals = survivors.map(x => keptOriginals[x.i]).filter(Boolean);
          result.analyses = survivors
            .map((x, newIdx) => {
              const a = result.analyses.find(an => an.image_index === x.i);
              return a ? { ...a, image_index: newIdx } : null;
            })
            .filter(Boolean) as any[];
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

        // Persist pre-mirror source URLs so we can recover if storage is corrupted
        const existingRaw = (prop as any).raw_data && typeof (prop as any).raw_data === 'object'
          ? (prop as any).raw_data : {};
        const updatedRaw = { ...existingRaw, original_image_urls: keptOriginals };

        const { error: updErr } = await supabase
          .from('external_properties')
          .update({
            images: displayImages,
            image_hashes: imageHashes,
            vibe_analysis: aggregated,
            highlights: positionalHighlights,
            vibe_status: 'complete',
            // Raw-harvested rows skipped the ingest gates (price sanity, sale
            // keywords, interior check) and still carry the source-language
            // title, so passing vision QC alone must not publish them.
            ...((prop as any).raw_only ? {} : { is_active: true }),
            raw_data: updatedRaw,
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
