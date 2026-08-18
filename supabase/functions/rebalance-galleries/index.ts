// Audits the galleries of already-published listings against the current crawl
// rules: no video/animated frames, no maps or plans, and interior shots must
// outnumber outdoor ones. Listings crawled before those rules existed never had
// their images checked this way, so this is the back-catalogue pass.
//
// One vision call per listing (gpt-4o-mini, detail:'low', whole gallery in a
// single message) labels every image; the trimming itself is done in code.
// Audited listings are stamped so repeat runs skip them.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { logOpenAIUsage, isOpenAIBudgetExhausted } from '../_shared/openai-usage.ts';
import {
  MIN_DISPLAY_IMAGES, interiorMajority,
  isVideoOrAnimatedUrl, isMapOrDiagramUrl, isCredibleMapLabel, isAnimatedOrVideoBytes,
} from '../_shared/vibe-policy.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MIRROR_BUCKET = 'external-property-images';
const AUDIT_VERSION = 1;          // bump to force a re-audit of everything
const DEFAULT_LIMIT = 20;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...Array.from(bytes.subarray(i, Math.min(i + chunk, bytes.length))));
  }
  return btoa(out);
}

type Fetched = { i: number; dataUrl: string } | { i: number; drop: string };

async function fetchImage(url: string, i: number): Promise<Fetched> {
  // URL rules first - free, and they cover the obvious cases
  if (isVideoOrAnimatedUrl(url)) return { i, drop: 'url_video_or_animated' };
  if (isMapOrDiagramUrl(url)) return { i, drop: 'url_map_or_diagram' };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return { i, drop: `http_${res.status}` };
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.startsWith('video/') || ct.includes('gif')) return { i, drop: 'content_type' };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) return { i, drop: 'size' };
    if (isAnimatedOrVideoBytes(bytes)) return { i, drop: 'animated_bytes' };
    let mime = 'image/jpeg';
    if (ct.includes('png')) mime = 'image/png';
    else if (ct.includes('webp')) mime = 'image/webp';
    return { i, dataUrl: `data:${mime};base64,${bytesToBase64(bytes)}` };
  } catch (e) {
    return { i, drop: `fetch_error:${String(e).substring(0, 40)}` };
  }
}

// The model reliably confuses "aerial photograph" with "map view", and a map
// label deletes an image, so the label only counts when it can name the drawn
// elements it saw - and that reason must not itself describe photography.
// Anything unconvincing is demoted to "outdoor", where the ratio rule decides.
async function labelGallery(
  openaiKey: string,
  items: { i: number; dataUrl: string }[],
): Promise<Map<number, { interior: boolean; map: boolean }> | null> {
  const prompt = `You are auditing ${items.length} photos from one rental apartment listing.

For EACH image, judged only by what is visible in it (never by filename):

- "map": true ONLY when the image is not a photograph at all - a drawn or
  rendered graphic: street/satellite map artwork, site plan, floor plan,
  elevation drawing, directions graphic, price or contact card, text collage,
  or a frame grabbed from a video or animation (play button, timecode,
  letterboxed thumbnail with a logo).
  A real photograph is NEVER a map, no matter what it shows. Drone and aerial
  photographs, skyline and river panoramas, and shots taken from a balcony or
  window are photographs - mark those map:false, interior:false.
- "why": REQUIRED whenever map is true. Name the drawn elements you can
  actually see that make it a graphic - "street names and pin markers",
  "north arrow and scale bar", "floor plan line drawing", "price text card".
  If you cannot name one, map is false.
- "interior": true when the photo was taken INSIDE the unit (living room,
  bedroom, kitchen, bathroom, dining area, hallway, or the view looking out
  from inside). false for building facades, lobbies, pools, gyms, gardens,
  streets, neighbourhood or aerial shots, and balconies shot from outside.

Images are given in order, index 0 first. Return ONLY valid JSON:
{"images":[{"i":0,"interior":true,"map":false,"why":""}]}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...items.map(it => ({ type: 'image_url', image_url: { url: it.dataUrl, detail: 'low' } })),
        ],
      }],
      max_tokens: 400,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    console.warn('[rebalance-galleries] OpenAI', res.status, (await res.text().catch(() => '')).substring(0, 200));
    return null;
  }
  const data = await res.json();
  logOpenAIUsage({ fn: 'rebalance-galleries', model: 'gpt-4o-mini', usage: data?.usage, images: items.length });
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') return null;
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[0]);
    const out = new Map<number, { interior: boolean; map: boolean }>();
    for (const row of parsed.images || []) {
      const pos = Number(row?.i);
      if (!Number.isInteger(pos) || pos < 0 || pos >= items.length) continue;
      out.set(items[pos].i, {
        interior: row?.interior !== false,
        map: isCredibleMapLabel(row?.map === true, String(row?.why || '')),
      });
    }
    return out.size > 0 ? out : null;
  } catch {
    return null;
  }
}

type Gate = { ok: true } | { ok: false; status: number; error: string };

async function requireServiceRoleOrAdmin(req: Request, supabase: any): Promise<Gate> {
  const token = (req.headers.get('Authorization') || req.headers.get('authorization') || '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  if (!token) return { ok: false, status: 401, error: 'Unauthorized' };

  if (token === (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')) return { ok: true };

  // A bare anon/publishable key is public, so it is explicitly not enough.
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const publishableKey = Deno.env.get('VITE_SUPABASE_PUBLISHABLE_KEY') ?? '';
  if (token === anonKey || (publishableKey && token === publishableKey)) {
    return { ok: false, status: 403, error: 'Forbidden: admin required' };
  }

  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return { ok: false, status: 401, error: 'Unauthorized' };

  const { data: isAdmin } = await supabase.rpc('has_role', { _user_id: user.id, _role: 'admin' });
  if (!isAdmin) return { ok: false, status: 403, error: 'Forbidden: admin required' };
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  // Ops-only. This is a back-catalogue maintenance pass that spends one vision
  // call per listing, so it must never be reachable by a stranger: the anon key
  // is published in the client bundle and does not count as a credential here.
  // Callers are the service role (manual ops, any future cron) or a signed-in
  // admin.
  const gate = await requireServiceRoleOrAdmin(req, supabase);
  if (!gate.ok) {
    return new Response(JSON.stringify({ error: gate.error }), {
      status: gate.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Same daily USD ceiling every other AI endpoint respects. A runaway loop
  // here is expensive even when the caller is legitimate.
  if (await isOpenAIBudgetExhausted()) {
    return new Response(JSON.stringify({ error: 'Daily OpenAI budget reached - try again tomorrow' }), {
      status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiKey) {
    return new Response(JSON.stringify({ error: 'OPENAI_API_KEY not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const body = await req.json().catch(() => ({}));
  const limit = Math.min(Number(body.limit) || DEFAULT_LIMIT, 40);
  const dryRun = body.dry_run === true;

  const summary = {
    audited: 0, unchanged: 0, trimmed: 0, images_removed: 0,
    maps_removed: 0, animated_removed: 0, outdoor_removed: 0,
    below_floor: [] as { id: string; kept: number }[],
    no_interior: [] as { id: string; images: number }[],
    failed: [] as { id: string; reason: string }[],
  };

  try {
    let query = supabase
      .from('external_properties')
      .select('id, images, highlights, vibe_analysis')
      .eq('is_active', true)
      .eq('raw_only', false);

    if (Array.isArray(body.ids) && body.ids.length > 0) {
      query = query.in('id', body.ids);
    } else {
      query = query.or(`vibe_analysis->>gallery_audit_v.is.null,vibe_analysis->>gallery_audit_v.lt.${AUDIT_VERSION}`);
    }

    const { data: rows, error } = await query.order('crawled_at', { ascending: true }).limit(limit);
    if (error) throw error;
    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({ message: 'Nothing left to audit', summary }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    for (const row of rows) {
      const images: string[] = Array.isArray(row.images) ? row.images : [];
      if (images.length === 0) {
        summary.failed.push({ id: row.id, reason: 'no_images' });
        continue;
      }
      summary.audited++;

      const fetched = await Promise.all(images.map((u, i) => fetchImage(u, i)));
      const usable = fetched.filter((f): f is { i: number; dataUrl: string } => 'dataUrl' in f);
      const hardDrops = new Map<number, string>();
      for (const f of fetched) if ('drop' in f) hardDrops.set(f.i, f.drop);

      if (usable.length === 0) {
        summary.failed.push({ id: row.id, reason: 'no_fetchable_images' });
        continue;
      }

      const labels = await labelGallery(openaiKey, usable);
      if (!labels) {
        summary.failed.push({ id: row.id, reason: 'labelling_failed' });
        continue;
      }

      // Anything unreachable keeps its place rather than being thrown away on a
      // transient network error; only positive signals remove an image.
      const photos = images
        .map((url, i) => ({ url, i, label: labels.get(i) }))
        .filter(p => {
          const hard = hardDrops.get(p.i);
          if (hard && !hard.startsWith('http_') && !hard.startsWith('fetch_error')) return false;
          return !(p.label?.map === true);
        });

      const mapsRemoved = images.length - photos.length;
      const kept = interiorMajority(photos, p => p.label?.interior !== false);
      const keptIdx = new Set(kept.map(p => p.i));
      const removed = images.filter((_, i) => !keptIdx.has(i));

      if (removed.length === 0) {
        summary.unchanged++;
        if (!dryRun) {
          await supabase.from('external_properties').update({
            vibe_analysis: { ...(row.vibe_analysis || {}), gallery_audit_v: AUDIT_VERSION },
          }).eq('id', row.id);
        }
        continue;
      }

      // Never publish an empty gallery. A listing with no interior photo at all
      // is a content problem, not a trimming problem - leave it untouched and
      // unstamped so it surfaces for review on every run.
      if (kept.length === 0) {
        summary.no_interior.push({ id: row.id, images: images.length });
        // Stamped so the pass moves on, flagged so it can be pulled up later.
        if (!dryRun) {
          await supabase.from('external_properties').update({
            vibe_analysis: {
              ...(row.vibe_analysis || {}),
              gallery_audit_v: AUDIT_VERSION,
              gallery_audit_flag: 'no_interior',
            },
          }).eq('id', row.id);
        }
        continue;
      }

      if (kept.length < MIN_DISPLAY_IMAGES) summary.below_floor.push({ id: row.id, kept: kept.length });
      summary.trimmed++;
      summary.images_removed += removed.length;
      summary.maps_removed += mapsRemoved;
      summary.animated_removed += [...hardDrops.values()].filter(r =>
        r.includes('animated') || r.includes('video') || r === 'content_type').length;
      summary.outdoor_removed += removed.length - mapsRemoved;

      if (dryRun) continue;

      // Interiors lead, so the cover photo is a room. Highlights and per-image
      // analyses are positional, so they are re-indexed onto the survivors.
      const oldHighlights: string[] = Array.isArray(row.highlights) ? row.highlights : [];
      const oldAnalyses: any[] = Array.isArray(row.vibe_analysis?.image_analyses)
        ? row.vibe_analysis.image_analyses : [];

      const newImages = kept.map(p => p.url);
      const newHighlights = kept.map(p => oldHighlights[p.i]).filter(Boolean);
      const newAnalyses = kept
        .map((p, newIdx) => {
          const a = oldAnalyses.find(x => Number(x?.image_index) === p.i) ?? oldAnalyses[p.i];
          return a ? { ...a, image_index: newIdx } : null;
        })
        .filter(Boolean);

      const { error: upErr } = await supabase.from('external_properties').update({
        images: newImages,
        highlights: newHighlights.length > 0 ? newHighlights : row.highlights,
        vibe_analysis: {
          ...(row.vibe_analysis || {}),
          ...(newAnalyses.length > 0 ? { image_analyses: newAnalyses } : {}),
          gallery_audit_v: AUDIT_VERSION,
        },
        updated_at: new Date().toISOString(),
      }).eq('id', row.id);

      if (upErr) {
        summary.failed.push({ id: row.id, reason: `update_failed:${upErr.message}` });
        continue;
      }

      // Mirrors nothing links to any more
      const stalePaths = removed
        .map(u => u.split(`/${MIRROR_BUCKET}/`)[1])
        .filter(Boolean) as string[];
      if (stalePaths.length > 0) {
        await supabase.storage.from(MIRROR_BUCKET).remove(stalePaths).catch(() => {});
      }

      console.log(`[rebalance-galleries] ${row.id}: ${images.length} -> ${newImages.length} images`);
    }

    if (summary.trimmed > 0 && !dryRun) {
      try {
        await supabase.functions.invoke('property-discovery-cache', { body: { action: 'invalidate' } });
      } catch (e) {
        console.error('[rebalance-galleries] cache invalidation failed:', e);
      }
    }

    return new Response(JSON.stringify({ message: 'Audit pass complete', summary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[rebalance-galleries] fatal:', e);
    return new Response(JSON.stringify({ error: String(e), summary }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
