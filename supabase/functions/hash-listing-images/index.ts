// Backfill-only hasher for listings whose photos were mirrored before
// process-vibe-queue started hashing inline. Runs on demand, not on a cron:
// every image it touches is a download from our own storage, which is metered
// egress. New listings get their hashes for free during mirroring.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.4';
import { dHashFromBytes } from '../_shared/dhash.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Image decode is CPU/memory heavy for an edge function - small batches,
// modest image sizes, invoke repeatedly to grind through a backlog.
const LISTINGS_PER_RUN = 4;
const IMAGES_PER_LISTING = 3;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

async function dHash(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t));
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return null;
    return await dHashFromBytes(buf);
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const summary = { listings: 0, hashed_images: 0, failed_images: 0 };
  try {
    const { data: listings, error } = await supabase
      .from('external_properties')
      .select('id, images')
      .eq('is_active', true)
      .is('image_hashes', null)
      .limit(LISTINGS_PER_RUN);
    if (error) throw error;

    for (const l of listings || []) {
      const urls = (l.images || []).slice(0, IMAGES_PER_LISTING);
      const hashes: string[] = [];
      for (const u of urls) {
        const h = await dHash(u);
        if (h) { hashes.push(h); summary.hashed_images++; }
        else summary.failed_images++;
      }
      // Empty array (vs null) marks "attempted" so failing listings don't
      // get re-picked forever.
      await supabase.from('external_properties')
        .update({ image_hashes: hashes })
        .eq('id', l.id);
      summary.listings++;
    }

    return new Response(JSON.stringify({ message: 'Hashing complete', summary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[hash-listing-images] Error:', e);
    return new Response(JSON.stringify({ error: (e as Error).message, summary }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
