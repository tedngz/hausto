// Computes perceptual (difference) hashes for listing photos so the dedupe
// pass can match the same unit across agents regardless of listing text.
// dHash: resize to 9x8 grayscale, compare adjacent pixels -> 64-bit hex.
// Robust to recompression/resizing; no LLM cost.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.4';
import { Image } from 'https://deno.land/x/imagescript@1.2.15/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Image decode is CPU/memory heavy for an edge function - small batches,
// modest image sizes, let the 30-min cron grind through the backlog.
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
    const img = await Image.decode(buf);
    const small = img.resize(9, 8);
    // Grayscale luma per pixel
    const gray: number[] = [];
    for (let y = 1; y <= 8; y++) {
      for (let x = 1; x <= 9; x++) {
        const [r, g, b] = Image.colorToRGB(small.getPixelAt(x, y));
        gray.push(0.299 * r + 0.587 * g + 0.114 * b);
      }
    }
    let bits = '';
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const i = row * 9 + col;
        bits += gray[i] < gray[i + 1] ? '1' : '0';
      }
    }
    return BigInt('0b' + bits).toString(16).padStart(16, '0');
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
