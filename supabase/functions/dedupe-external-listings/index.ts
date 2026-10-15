// Clusters external listings that are very likely the same physical unit posted
// by multiple agents. Deterministic heuristics only (no LLM cost):
//   same project key (first location segment, diacritics-stripped)
//   + same city + same rooms
//   + size within ±3 m² (when both parse)
//   + price within ±10%
// Groups get a row in listing_groups; members get canonical_group_id set.
// Runs nightly via pg_cron; safe to re-run (idempotent rebuild).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.4';
import { isGenericLocationKey, normalizeRooms, projectKey, scanImagePairs } from './match.ts';

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
  created_at: string | null;
  is_active: boolean;
  deactivated_at: string | null;
  image_hashes: string[] | null;
  canonical_group_id: string | null;
  district_code: string | null;
  image_conflict_dismissed_at: string | null;
};

// How far back a dead listing still counts as evidence of the unit's identity.
// Beyond this it stops informing relists and drops out of the clustering pull.
const HISTORY_WINDOW_DAYS = 365;

function parseSizeSqm(size: string | null): number | null {
  if (!size) return null;
  const m = String(size).match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(',', '.'));
  return Number.isFinite(n) && n > 5 && n < 2000 ? n : null;
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

  const summary = {
    listings: 0, active_listings: 0, buckets: 0, groups: 0, grouped_listings: 0,
    image_merges: 0, image_conflicts: 0, groups_reused: 0, groups_created: 0, relists: 0,
    generic_keys_skipped: 0, dismissed_conflicts_skipped: 0,
  };

  try {
    // Pull active listings plus recently deactivated ones. History matters here:
    // a unit whose ads have all expired must keep its identity, otherwise a
    // fresh posting of the same apartment reads as a brand new unit.
    const historyCutoff = new Date(Date.now() - HISTORY_WINDOW_DAYS * 86400_000).toISOString();
    const all: Listing[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('external_properties')
        .select('id, title, location, city, rooms, price, size, last_verified_at, crawled_at, created_at, is_active, deactivated_at, image_hashes, canonical_group_id, district_code, image_conflict_dismissed_at')
        .or(`is_active.eq.true,deactivated_at.gte.${historyCutoff}`)
        .range(from, from + 999);
      if (error) throw error;
      all.push(...(data || []) as Listing[]);
      if (!data || data.length < 1000) break;
    }
    summary.listings = all.length;
    summary.active_listings = all.filter((l) => l.is_active).length;

    // Bucket by project + city + rooms
    const buckets = new Map<string, Listing[]>();
    for (const l of all) {
      const pk = projectKey(l.location);
      if (isGenericLocationKey(pk)) { summary.generic_keys_skipped++; continue; }
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

    // Image-fingerprint pass (match.ts): shared photos at the same place
    // merge; at a different place they flag both listings, unless ops already
    // marked one legit against the listings it was compared with then.
    const { merges, conflictIds, dismissedSkips } = scanImagePairs(all);
    for (const [i, j] of merges) union(i, j);
    summary.image_merges = merges.length;
    summary.image_conflicts = conflictIds.size;
    summary.dismissed_conflicts_skipped = dismissedSkips;

    const groupOf = new Map<string, string[]>(); // representative listing id -> member ids
    const clusters = new Map<number, number[]>();
    for (let i = 0; i < all.length; i++) {
      const root = find(i);
      (clusters.get(root) || clusters.set(root, []).get(root)!).push(i);
    }
    for (const idxs of clusters.values()) {
      if (idxs.length < 2) continue;
      // Representative: a live posting whenever the unit has one (it is what
      // public surfaces render), then most recently verified, then crawled.
      const members = idxs.map((i) => all[i]);
      members.sort((a, b) =>
        Number(b.is_active) - Number(a.is_active) ||
        (b.last_verified_at || '').localeCompare(a.last_verified_at || '') ||
        (b.crawled_at || '').localeCompare(a.crawled_at || ''));
      groupOf.set(members[0].id, members.map((m) => m.id));
    }

    // Conflict flags are recomputed each run. A "Legit" survives because it
    // lives in image_conflict_dismissed_at, which scanImagePairs reads, not in
    // the flag this resets.
    await supabase.from('external_properties')
      .update({ image_location_conflict: false })
      .eq('image_location_conflict', true);
    if (conflictIds.size > 0) {
      await supabase.from('external_properties')
        .update({ image_location_conflict: true })
        .in('id', Array.from(conflictIds));
    }

    const byId = new Map(all.map((l) => [l.id, l]));
    const keptGroupIds = new Set<string>();
    const clusteredIds = new Set<string>();
    const relistIds = new Set<string>();

    for (const [repId, memberIds] of groupOf) {
      const rep = byId.get(repId)!;
      const members = memberIds.map((id) => byId.get(id)!);
      const active = members.filter((m) => m.is_active);
      const dead = members.filter((m) => !m.is_active);

      // The live price band describes what a renter can act on today, so a
      // dead posting's old asking price must not widen it.
      const prices = (active.length > 0 ? active : members)
        .map((m) => Number(m.price) || 0)
        .filter((p) => p > 0);
      const createdTimes = members.map((m) => m.created_at).filter(Boolean) as string[];

      // A live posting is a relist when this unit was already on the market
      // under an earlier posting that has since died.
      for (const a of active) {
        if (dead.some((d) => (d.created_at || '') < (a.created_at || ''))) relistIds.add(a.id);
      }

      const row = {
        project_key: projectKey(rep.location),
        city: rep.city,
        rooms: rep.rooms,
        size_sqm: parseSizeSqm(rep.size),
        price_min: prices.length > 0 ? Math.min(...prices) : null,
        price_max: prices.length > 0 ? Math.max(...prices) : null,
        member_count: active.length,
        total_member_count: members.length,
        first_seen_at: createdTimes.length > 0 ? createdTimes.sort()[0] : null,
        representative_id: repId,
        updated_at: new Date().toISOString(),
      };

      // Keep the unit's existing identity: reuse whichever group the previous
      // run assigned to these members. Only a cluster with no prior member
      // mints a new UUID, so canonical_group_id survives across runs.
      const priorCounts = new Map<string, number>();
      for (const m of members) {
        if (!m.canonical_group_id || keptGroupIds.has(m.canonical_group_id)) continue;
        priorCounts.set(m.canonical_group_id, (priorCounts.get(m.canonical_group_id) || 0) + 1);
      }
      const reuseId = [...priorCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

      let groupId: string;
      if (reuseId) {
        const { error: uErr } = await supabase.from('listing_groups').update(row).eq('id', reuseId);
        if (uErr) throw uErr;
        groupId = reuseId;
        summary.groups_reused++;
      } else {
        const { data: group, error: gErr } = await supabase
          .from('listing_groups').insert(row).select('id').single();
        if (gErr) throw gErr;
        groupId = group.id;
        summary.groups_created++;
      }
      keptGroupIds.add(groupId);

      const { error: mErr } = await supabase
        .from('external_properties')
        .update({ canonical_group_id: groupId })
        .in('id', memberIds);
      if (mErr) throw mErr;
      for (const id of memberIds) clusteredIds.add(id);

      summary.groups++;
      summary.grouped_listings += memberIds.length;
    }

    // Listings that no longer cluster with anything lose their assignment.
    const unclustered = all.filter((l) => !clusteredIds.has(l.id) && l.canonical_group_id);
    for (let i = 0; i < unclustered.length; i += 200) {
      const { error } = await supabase
        .from('external_properties')
        .update({ canonical_group_id: null })
        .in('id', unclustered.slice(i, i + 200).map((l) => l.id));
      if (error) throw error;
    }

    // Relist flags are recomputed each run, like the conflict flags above.
    await supabase.from('external_properties').update({ is_relist: false }).eq('is_relist', true);
    const relistArr = Array.from(relistIds);
    for (let i = 0; i < relistArr.length; i += 200) {
      const { error } = await supabase
        .from('external_properties')
        .update({ is_relist: true })
        .in('id', relistArr.slice(i, i + 200));
      if (error) throw error;
    }
    summary.relists = relistArr.length;

    // Drop groups nothing points at any more, then clear references held by
    // listings older than the history window whose group has just gone.
    const existingGroups: { id: string }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('listing_groups').select('id').range(from, from + 999);
      if (error) throw error;
      existingGroups.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    const stale = existingGroups.map((g) => g.id).filter((id) => !keptGroupIds.has(id));
    for (let i = 0; i < stale.length; i += 200) {
      const { error } = await supabase.from('listing_groups').delete().in('id', stale.slice(i, i + 200));
      if (error) throw error;
    }
    if (stale.length > 0) {
      const { error } = await supabase.rpc('prune_orphan_listing_group_refs');
      if (error) throw error;
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
