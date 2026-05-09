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
const DEFAULT_BATCH = 10;

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
    const safeId = externalId.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 80);
    const path = `${safeId}/${idx}.${ext}`;
    const { error } = await supabase.storage.from(MIRROR_BUCKET).upload(path, buf, { contentType: ct, upsert: true });
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

    let q = adminClient
      .from('external_properties')
      .select('id, external_id, source, images, raw_only')
      .eq('is_active', true)
      .order('crawled_at', { ascending: false })
      .limit(batchSize * 4); // overfetch to filter
    if (!includeRaw) q = q.eq('raw_only', false);

    const { data: rows, error } = await q;
    if (error) throw error;

    const needsMirror = (rows || []).filter((r: any) =>
      Array.isArray(r.images) && r.images.some((u: string) => u && !u.includes(`/${MIRROR_BUCKET}/`))
    ).slice(0, batchSize);

    const results: any[] = [];
    for (const row of needsMirror) {
      const key = `${row.source || 'src'}-${row.external_id || row.id}`;
      const mirrored: string[] = [];
      for (let i = 0; i < row.images.length; i++) {
        mirrored.push(await mirrorOne(adminClient, row.images[i], key, i));
      }
      const changed = mirrored.some((u, i) => u !== row.images[i]);
      if (changed) {
        await adminClient.from('external_properties').update({ images: mirrored, updated_at: new Date().toISOString() }).eq('id', row.id);
      }
      results.push({ id: row.id, mirrored: mirrored.filter(u => u.includes(`/${MIRROR_BUCKET}/`)).length, total: mirrored.length });
    }

    return new Response(JSON.stringify({ success: true, processed: results.length, remaining_candidates: Math.max(0, (rows?.length || 0) - results.length), results }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[backfill-external-images] fatal:', e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
