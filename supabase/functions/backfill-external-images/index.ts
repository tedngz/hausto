// Mirrors remote-CDN images on existing external_properties rows into the
// `external-property-images` storage bucket so listings survive source removal.
// Admin-only. Processes a small batch per invocation to stay under Edge limits.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MIRROR_BUCKET = 'external-property-images';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
// Matches process-vibe-queue: a long CDN TTL keeps repeat views off origin.
const MIRROR_CACHE_CONTROL = '604800'; // 7 days
const DEFAULT_BATCH = 10;

async function safeFolder(externalId: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(externalId));
  const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  const readable = externalId.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
  return `${readable}-${hex.substring(0, 16)}`;
}

async function mirrorOne(supabase: any, url: string, externalId: string, idx: number): Promise<string> {
  try {
    if (!url || url.includes(`/${MIRROR_BUCKET}/`)) return url;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 HaustoBot' } });
    clearTimeout(t);
    if (!res.ok) return url;
    const ct = (res.headers.get('content-type') || 'image/jpeg').toLowerCase();
    if (!ct.startsWith('image/')) return url;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (!buf.byteLength || buf.byteLength > MAX_IMAGE_BYTES) return url;
    const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg';
    const folder = await safeFolder(externalId);
    const path = `${folder}/${idx}.${ext}`;
    const { error } = await supabase.storage.from(MIRROR_BUCKET)
      .upload(path, buf, { contentType: ct, upsert: true, cacheControl: MIRROR_CACHE_CONTROL });
    if (error) { console.warn('[backfill] upload failed:', error.message); return url; }
    const { data } = supabase.storage.from(MIRROR_BUCKET).getPublicUrl(path);
    return data?.publicUrl || url;
  } catch (e) {
    console.warn('[backfill] error:', String(e).substring(0, 200));
    return url;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    // Auth: require admin role
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'No authorization' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const token = authHeader.replace('Bearer ', '');
    const { data: { user } } = await adminClient.auth.getUser(token);
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const { data: isAdmin } = await adminClient.rpc('has_role', { _user_id: user.id, _role: 'admin' });
    if (!isAdmin) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const body = await req.json().catch(() => ({}));
    const batchSize = Math.min(Number(body.batchSize) || DEFAULT_BATCH, 25);
    const includeRaw = !!body.includeRaw;
    const includeInactive = !!body.includeInactive;
    const action = String(body.action || '').toLowerCase();

    // ============================================================
    // REPAIR MODE: detect collisions from the legacy truncated-key
    // mirror scheme and reset affected rows.
    //
    // The old key format was `${source}-${external_id}` truncated to
    // 80 chars, which collapsed many distinct listings to the same
    // storage folder. New format ends with `-<16-hex>`.
    // ============================================================
    if (action === 'repair-collisions') {
      const { data: allRows, error: scanErr } = await adminClient
        .from('external_properties')
        .select('id, external_id, source, images, raw_data, source_url')
        .not('images', 'is', null)
        .limit(2000);
      if (scanErr) throw scanErr;

      const HEX16 = /-[0-9a-f]{16}\/\d+\.[a-z]+$/i;
      // Group by legacy folder (segment between bucket name and the next slash)
      const byFolder = new Map<string, any[]>();
      for (const r of (allRows || []) as any[]) {
        const imgs: string[] = Array.isArray(r.images) ? r.images : [];
        const legacy = imgs.find(u => u && u.includes(`/${MIRROR_BUCKET}/`) && !HEX16.test(u));
        if (!legacy) continue;
        const m = legacy.match(new RegExp(`/${MIRROR_BUCKET}/([^/]+)/`));
        if (!m) continue;
        const folder = m[1];
        const arr = byFolder.get(folder) || [];
        arr.push(r);
        byFolder.set(folder, arr);
      }

      let restored = 0, cleared = 0, untouched = 0;
      const collisionFolders: string[] = [];
      for (const [folder, group] of byFolder.entries()) {
        if (group.length < 2) { untouched += 1; continue; }
        collisionFolders.push(folder);
        for (const row of group) {
          const orig = row.raw_data?.original_image_urls;
          if (Array.isArray(orig) && orig.length > 0) {
            await adminClient
              .from('external_properties')
              .update({ images: orig, updated_at: new Date().toISOString() })
              .eq('id', row.id);
            restored += 1;
          } else {
            // No originals to recover from — hide the listing and queue
            // it for a fresh crawl so it doesn't keep showing wrong photos.
            await adminClient
              .from('external_properties')
              .update({
                images: [],
                is_active: false,
                vibe_status: 'pending',
                updated_at: new Date().toISOString(),
              })
              .eq('id', row.id);
            cleared += 1;
          }
        }
      }

      return new Response(JSON.stringify({
        success: true,
        mode: 'repair-collisions',
        scanned: allRows?.length || 0,
        collision_folders: collisionFolders.length,
        rows_restored_from_raw_data: restored,
        rows_cleared_for_recrawl: cleared,
        non_colliding_legacy_rows: untouched,
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }


    // Order by updated_at ASC so rows we just mirrored (which get bumped
    // updated_at) sink to the back and unmirrored rows surface first.
    // This acts as a self-advancing cursor across many invocations.
    let q = adminClient
      .from('external_properties')
      .select('id, external_id, source, images, raw_only, is_active, updated_at')
      .not('images', 'is', null)
      .order('updated_at', { ascending: true, nullsFirst: true })
      .limit(batchSize * 10); // overfetch to filter out already-mirrored
    if (!includeRaw) q = q.eq('raw_only', false);
    if (!includeInactive) q = q.eq('is_active', true);

    const { data: rows, error } = await q;
    if (error) throw error;

    const allRows = rows || [];
    const needsMirror = allRows.filter((r: any) =>
      Array.isArray(r.images) && r.images.some((u: string) => u && !u.includes(`/${MIRROR_BUCKET}/`))
    ).slice(0, batchSize);

    // Push fully-mirrored overfetched rows to the back of the cursor so they
    // don't keep occupying the front of the updated_at queue on later rounds.
    const alreadyDoneIds = allRows
      .filter((r: any) => !needsMirror.includes(r) && Array.isArray(r.images) && r.images.length > 0
        && r.images.every((u: string) => u && u.includes(`/${MIRROR_BUCKET}/`)))
      .map((r: any) => r.id);
    if (alreadyDoneIds.length > 0) {
      await adminClient
        .from('external_properties')
        .update({ updated_at: new Date().toISOString() })
        .in('id', alreadyDoneIds);
    }

    const results: any[] = [];
    for (const row of needsMirror) {
      const key = `${row.source || 'src'}-${row.external_id || row.id}`;
      const mirrored: string[] = [];
      for (let i = 0; i < row.images.length; i++) {
        mirrored.push(await mirrorOne(adminClient, row.images[i], key, i));
      }
      const changed = mirrored.some((u, i) => u !== row.images[i]);
      // Always bump updated_at so the cursor advances even when every image
      // upload fell back to the original URL (e.g. dead source CDN).
      await adminClient
        .from('external_properties')
        .update(changed ? { images: mirrored, updated_at: new Date().toISOString() } : { updated_at: new Date().toISOString() })
        .eq('id', row.id);
      results.push({ id: row.id, mirrored: mirrored.filter(u => u.includes(`/${MIRROR_BUCKET}/`)).length, total: mirrored.length });
    }

    return new Response(JSON.stringify({
      success: true,
      processed: results.length,
      scanned: allRows.length,
      bumped_already_done: alreadyDoneIds.length,
      remaining_candidates: Math.max(0, allRows.length - results.length - alreadyDoneIds.length),
      results,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[backfill-external-images] fatal:', e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
