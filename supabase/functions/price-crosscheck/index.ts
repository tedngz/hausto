// The price cross-check (SPEC §0 `price_confidence`, PLAN-v3 S3). Runs on
// pg_cron, reads the rent each active listing's title and description quote,
// and stores the range on the row. The trigger does the rest:
// `price_confidence_for` marks the price LOW when it sits more than 15% outside
// that range, and a LOW listing cannot be requested.
//
// Reading is `_shared/price-mentions.ts`, pure and tested; deciding is SQL, so
// it holds on every write and not only when this runs. This function is the
// I/O between them. It scans every active row each pass rather than keeping a
// "checked" marker: there are hundreds, not millions, and a full pass is what
// notices a description that was rewritten after the last one.
//
// POST {} writes. POST {"dryRun": true} reports what would change and writes
// nothing - the way to look before trusting a parser change.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { describedPrice } from '../_shared/price-mentions.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const PAGE = 1000;

interface Row {
  id: string;
  title: string | null;
  description: string | null;
  price_vnd: number | null;
  described_price_min_vnd: number | null;
  described_price_max_vnd: number | null;
}

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

  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('external_properties')
      .select('id, title, description, price_vnd, described_price_min_vnd, described_price_max_vnd')
      .eq('is_active', true)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) return json({ error: error.message }, 500);
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE) break;
  }

  let withRange = 0;
  const changes = rows.flatMap((r) => {
    const d = describedPrice(r.title, r.description);
    if (d) withRange++;
    const min = d?.min_vnd ?? null;
    const max = d?.max_vnd ?? null;
    return min === r.described_price_min_vnd && max === r.described_price_max_vnd
      ? []
      : [{ id: r.id, price_vnd: r.price_vnd, min, max }];
  });

  if (dryRun) {
    return json({ success: true, dryRun, scanned: rows.length, with_range: withRange, would_change: changes });
  }

  let written = 0;
  const failed: string[] = [];
  for (const c of changes) {
    const { error } = await db
      .from('external_properties')
      .update({ described_price_min_vnd: c.min, described_price_max_vnd: c.max })
      .eq('id', c.id);
    if (error) failed.push(`${c.id}: ${error.message}`);
    else written++;
  }

  // What this pass turned LOW, read back from the row the trigger wrote, so the
  // log names each listing that just stopped being requestable and why.
  const changedIds = changes.map((c) => c.id);
  const { data: nowLow } = changedIds.length
    ? await db
        .from('external_properties')
        .select('id, price_vnd, described_price_min_vnd, described_price_max_vnd')
        .in('id', changedIds)
        .eq('price_confidence', 'LOW')
    : { data: [] };
  for (const r of nowLow ?? []) {
    console.log(
      `[price-crosscheck] LOW ${r.id}: price ${r.price_vnd} vs text ${r.described_price_min_vnd}-${r.described_price_max_vnd}`,
    );
  }

  console.log(
    `[price-crosscheck] scanned ${rows.length}, with a quoted rent ${withRange}, updated ${written}, ` +
      `now LOW ${(nowLow ?? []).length}, failed ${failed.length}`,
  );
  return json({
    success: failed.length === 0,
    scanned: rows.length,
    with_range: withRange,
    updated: written,
    now_low: (nowLow ?? []).map((r) => r.id),
    failed,
  });
});
