// Storage garbage collection. Runs daily on pg_cron (migration
// 20261109100000_storage_gc.sql), with the cron secret.
//
// The free plan holds 1 GB, and two things filled it: photos of listings long
// dead, which nothing ever deleted, and photos a killed mirroring run uploaded
// but never recorded on its listing. This
//
//   1. hands a listing dead for 30+ days back its source's image URLs in place
//      of our copies (storage_gc_release_dead_listings), then
//   2. deletes files nothing points to - no listing, property, building,
//      avatar or chat message - past a grace period (storage_gc_orphans),
//      through the Storage API, in batches.
//
// Deciding is SQL, so the rules sit in one place; this is the I/O. Release
// runs first, so a failed delete leaves an orphan the next run retries rather
// than a listing pointing at a missing file. Agents' photos (concierge/) and
// listings on a viewing request are never touched.
//
// POST {} deletes. POST {"dryRun": true} reports what would go and changes
// nothing.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/** Paths per Storage API delete call. The API takes up to 1000. */
const BATCH = 500;
/** Files deleted per run, so one run cannot outlast the function's wall clock. */
const MAX_PER_RUN = 5000;
/** A listing inactive this long, and on no request, has its photos released. */
const DEAD_DAYS = 30;
const TIME_BUDGET_MS = 100_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

interface Orphan { bucket: string; path: string; bytes: number }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE);

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const cronSecret = req.headers.get('x-cron-secret') || '';
  let authorized = token === SERVICE_ROLE;
  if (!authorized && cronSecret) {
    const { data } = await db.rpc('verify_cron_secret', { _token: cronSecret });
    authorized = data === true;
  }
  if (!authorized) return json({ error: 'Unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dryRun === true;
  const started = Date.now();

  if (dryRun) {
    const { data, error } = await db.rpc('storage_gc_orphans', { _limit: MAX_PER_RUN });
    if (error) return json({ error: error.message }, 500);
    const rows = (data ?? []) as Orphan[];
    return json({ dryRun: true, ...tally(rows), note: 'Dead listings are not released in a dry run, so their photos are not counted here.' });
  }

  const { data: released, error: relErr } = await db.rpc('storage_gc_release_dead_listings', {
    _dead_days: DEAD_DAYS, _limit: 500,
  });
  if (relErr) return json({ error: `release: ${relErr.message}` }, 500);

  const deleted: Orphan[] = [];
  const failures: string[] = [];
  while (deleted.length < MAX_PER_RUN && Date.now() - started < TIME_BUDGET_MS) {
    const { data, error } = await db.rpc('storage_gc_orphans', { _limit: BATCH });
    if (error) { failures.push(`lookup: ${error.message}`); break; }
    const rows = (data ?? []) as Orphan[];
    if (rows.length === 0) break;

    let removedThisRound = 0;
    for (const [bucket, group] of groupBy(rows, r => r.bucket)) {
      const { data: gone, error: rmErr } = await db.storage.from(bucket).remove(group.map(r => r.path));
      if (rmErr) { failures.push(`${bucket}: ${rmErr.message}`); continue; }
      const goneNames = new Set(((gone ?? []) as { name: string }[]).map(o => o.name));
      for (const r of group) if (goneNames.has(r.path)) deleted.push(r);
      removedThisRound += goneNames.size;
    }
    // Nothing came out: the same rows would come back forever.
    if (removedThisRound === 0) break;
  }

  const summary = { released: released ?? 0, ...tally(deleted), failures, ms: Date.now() - started };
  console.log(`[storage-gc] released ${summary.released} dead listing(s), deleted ${summary.files} file(s), ${summary.mb} MB${failures.length ? `, ${failures.length} failure(s): ${failures.join('; ')}` : ''}`);
  return json(summary, failures.length && !deleted.length ? 500 : 200);
});

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r); else m.set(k, [r]);
  }
  return m;
}

function tally(rows: Orphan[]) {
  const byBucket: Record<string, { files: number; mb: number }> = {};
  let bytes = 0;
  for (const r of rows) {
    const b = (byBucket[r.bucket] ??= { files: 0, mb: 0 });
    b.files += 1;
    b.mb += Number(r.bytes) / 1_048_576;
    bytes += Number(r.bytes);
  }
  for (const b of Object.values(byBucket)) b.mb = Math.round(b.mb * 10) / 10;
  return { files: rows.length, mb: Math.round((bytes / 1_048_576) * 10) / 10, byBucket };
}
