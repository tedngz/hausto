// Clusters external listings that are very likely the same physical unit posted
// by multiple agents. Deterministic heuristics only (no LLM cost):
//   same project key (first location segment, diacritics-stripped)
//   + same city + same rooms
//   + size within ±3 m² (when both parse)
//   + price within ±10%
// Groups get a row in listing_groups; members get canonical_group_id set.
// Runs nightly via pg_cron; safe to re-run (idempotent rebuild).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SIZE_TOLERANCE_SQM = 3;
const PRICE_TOLERANCE = 0.10;

type Listing = {
  id: string;
  title: string;
  location: string;
  city: string | null;
  rooms: string | null;
  price: number | null;
  size: string | null;
  last_verified_at: string | null;
  crawled_at: string | null;
  image_hashes: string[] | null;
};

// Two image dHashes match when their Hamming distance is small (survives
// recompression and resizing of the same source photo).
const HAMMING_MAX = 6;
const IMAGE_MATCHES_REQUIRED = 2; // shared photos needed to call it the same unit

function hammingHex(a: string, b: string): number {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b);
  let count = 0;
  while (x) { count += Number(x & 1n); x >>= 1n; }
  return count;
}

function imageOverlap(a: Listing, b: Listing): number {
  const ha = a.image_hashes || [], hb = b.image_hashes || [];
  if (ha.length === 0 || hb.length === 0) return 0;
  let matches = 0;
  for (const x of ha) {
    if (hb.some((y) => hammingHex(x, y) <= HAMMING_MAX)) matches++;
  }
  return matches;
}

const stripDiacritics = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');

// Project key: the first comma-segment of the location, which for VN rental
// listings is almost always the building/complex name ("Feliz en Vista, ...").
function projectKey(location: string): string {
  const seg = (location || '').split(',')[0] || '';
  return stripDiacritics(seg).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function parseSizeSqm(size: string | null): number | null {
  if (!size) return null;
  const m = String(size).match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(',', '.'));
  return Number.isFinite(n) && n > 5 && n < 2000 ? n : null;
}

function normalizeRooms(rooms: string | null): string {
  const r = (rooms || '').toLowerCase();
  if (r.includes('studio')) return 'studio';
  const m = r.match(/(\d+)/);
  return m ? `${m[1]}br` : 'unknown';
}

function sameUnit(a: Listing, b: Listing, sizeA: number | null, sizeB: number | null): boolean {
  // Price proximity is required — identical project+rooms at very different
  // prices are usually genuinely different units.
  const pa = Number(a.price) || 0;
  const pb = Number(b.price) || 0;
  if (pa <= 0 || pb <= 0) return false;
  if (Math.abs(pa - pb) / Math.max(pa, pb) > PRICE_TOLERANCE) return false;
  // Size must agree when both are known; unknown size doesn't block grouping.
  if (sizeA !== null && sizeB !== null && Math.abs(sizeA - sizeB) > SIZE_TOLERANCE_SQM) return false;
  return true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const summary = { listings: 0, buckets: 0, groups: 0, grouped_listings: 0, image_merges: 0, image_conflicts: 0 };

  try {
    // Pull all active listings (paged; table is well under 10k rows)
    const all: Listing[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('external_properties')
        .select('id, title, location, city, rooms, price, size, last_verified_at, crawled_at, image_hashes')
        .eq('is_active', true)
        .range(from, from + 999);
      if (error) throw error;
      all.push(...(data || []) as Listing[]);
      if (!data || data.length < 1000) break;
    }
    summary.listings = all.length;

    // Bucket by project + city + rooms
    const buckets = new Map<string, Listing[]>();
    for (const l of all) {
      const pk = projectKey(l.location);
      if (!pk) continue;
      const key = `${pk}|${l.city || ''}|${normalizeRooms(l.rooms)}`;
      const arr = buckets.get(key) || [];
      arr.push(l);
      buckets.set(key, arr);
    }
    summary.buckets = buckets.size;

    // Global union-find: edges come from (a) the text heuristics within each
    // project bucket and (b) shared image fingerprints across ALL listings.
    const indexOf = new Map<string, number>(all.map((l, i) => [l.id, i]));
    const parent = all.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const union = (i: number, j: number) => { parent[find(i)] = find(j); };

    for (const [, items] of buckets) {
      if (items.length < 2) continue;
      const sizes = items.map((l) => parseSizeSqm(l.size));
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          if (sameUnit(items[i], items[j], sizes[i], sizes[j])) {
            union(indexOf.get(items[i].id)!, indexOf.get(items[j].id)!);
          }
        }
      }
    }

    // Image-fingerprint pass: agents repost the landlord's photo set, so
    // shared photos identify the same unit regardless of listing text.
    // Policy: same photos but materially different claimed location (or
    // different room count) is bait or stolen photos - flag both listings
    // for ops review, never merge them.
    const conflictIds = new Set<string>();
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      if (!a.image_hashes || a.image_hashes.length === 0) continue;
      for (let j = i + 1; j < all.length; j++) {
        const b = all[j];
        if (!b.image_hashes || b.image_hashes.length === 0) continue;
        const needed = Math.min(IMAGE_MATCHES_REQUIRED, a.image_hashes.length, b.image_hashes.length);
        if (imageOverlap(a, b) < needed) continue;
        const sameCity = (a.city || '') === (b.city || '');
        const sameProject = projectKey(a.location) === projectKey(b.location);
        const sameRooms = normalizeRooms(a.rooms) === normalizeRooms(b.rooms);
        if (sameCity && sameProject && sameRooms) {
          union(i, j);
          summary.image_merges++;
        } else {
          conflictIds.add(a.id);
          conflictIds.add(b.id);
        }
      }
    }
    summary.image_conflicts = conflictIds.size;

    const groupOf = new Map<string, string[]>(); // representative listing id -> member ids
    const clusters = new Map<number, number[]>();
    for (let i = 0; i < all.length; i++) {
      const root = find(i);
      (clusters.get(root) || clusters.set(root, []).get(root)!).push(i);
    }
    for (const idxs of clusters.values()) {
      if (idxs.length < 2) continue;
      // Representative: most recently verified, then most recently crawled
      const members = idxs.map((i) => all[i]);
      members.sort((a, b) =>
        (b.last_verified_at || '').localeCompare(a.last_verified_at || '') ||
        (b.crawled_at || '').localeCompare(a.crawled_at || ''));
      groupOf.set(members[0].id, members.map((m) => m.id));
    }

    // Rebuild groups: clear stale assignments, then write current ones
    const { error: clearErr } = await supabase
      .from('external_properties')
      .update({ canonical_group_id: null })
      .not('canonical_group_id', 'is', null);
    if (clearErr) throw clearErr;
    // Conflict flags are recomputed each run
    await supabase.from('external_properties')
      .update({ image_location_conflict: false })
      .eq('image_location_conflict', true);
    if (conflictIds.size > 0) {
      await supabase.from('external_properties')
        .update({ image_location_conflict: true })
        .in('id', Array.from(conflictIds));
    }
    // listing_groups is rebuilt from scratch each run
    await supabase.from('listing_groups').delete().not('id', 'is', null);

    const byId = new Map(all.map((l) => [l.id, l]));
    for (const [repId, memberIds] of groupOf) {
      const rep = byId.get(repId)!;
      const prices = memberIds.map((id) => Number(byId.get(id)!.price) || 0).filter((p) => p > 0);
      const { data: group, error: gErr } = await supabase
        .from('listing_groups')
        .insert({
          project_key: projectKey(rep.location),
          city: rep.city,
          rooms: rep.rooms,
          size_sqm: parseSizeSqm(rep.size),
          price_min: Math.min(...prices),
          price_max: Math.max(...prices),
          member_count: memberIds.length,
          representative_id: repId,
        })
        .select('id')
        .single();
      if (gErr) throw gErr;
      const { error: mErr } = await supabase
        .from('external_properties')
        .update({ canonical_group_id: group.id })
        .in('id', memberIds);
      if (mErr) throw mErr;
      summary.groups++;
      summary.grouped_listings += memberIds.length;
    }

    console.log('[dedupe-external-listings]', JSON.stringify(summary));
    return new Response(JSON.stringify({ message: 'Dedupe complete', summary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[dedupe-external-listings] Fatal:', e);
    return new Response(JSON.stringify({ error: (e as Error).message, summary }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
