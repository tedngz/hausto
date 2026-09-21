// Rewrites already-stored listings whose title or description is still in
// Vietnamese into English, using the text already in the database.
//
// nhatot listings were built straight from chotot's ad payload and skipped the
// AI writing step every other source goes through, so the seller's headline and
// their full emoji-strewn advert body were saved verbatim. This is the one-off
// cleanup for those rows; the crawler itself now rewrites at ingest.
//
// Text only - no page fetches, no re-crawl. Admin-only, capped batch, safe to
// re-run: a row that comes back clean is simply not selected next time.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeListingCopy, looksVietnamese } from "../_shared/listing-language.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DEFAULT_BATCH = 20;
const MAX_BATCH = 50;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'No authorization' }, 401);
    const { data: { user } } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
    if (!user) return json({ error: 'Unauthorized' }, 401);
    const { data: isAdmin } = await admin.rpc('has_role', { _user_id: user.id, _role: 'admin' });
    if (!isAdmin) return json({ error: 'Forbidden' }, 403);

    const body = await req.json().catch(() => ({}));
    const batchSize = Math.min(Number(body.batchSize) || DEFAULT_BATCH, MAX_BATCH);
    const includeInactive = !!body.includeInactive;

    // Pull a generous window and filter in code: the Vietnamese test is the
    // same one the rewriter uses, so scan and fix can never disagree.
    let query = admin
      .from('external_properties')
      .select('id, title, description, amenities, location, rooms, size, source, source_url')
      .order('updated_at', { ascending: false })
      .limit(500);
    if (!includeInactive) query = query.eq('is_active', true);

    const { data: rows, error } = await query;
    if (error) throw error;

    const candidates = (rows ?? []).filter(
      (r) => looksVietnamese(r.title) || looksVietnamese(r.description),
    );

    const targets = candidates.slice(0, batchSize);
    let rewritten = 0;
    let skipped = 0;
    const failures: string[] = [];

    for (const row of targets) {
      const copy = await normalizeListingCopy({
        title: row.title ?? '',
        description: row.description ?? '',
        amenities: Array.isArray(row.amenities) ? row.amenities : [],
        location: row.location ?? '',
        rooms: row.rooms ?? '',
        size: row.size ?? '',
        fn: 'backfill-listing-language',
        sourceUrl: row.source_url ?? undefined,
      });

      if (!copy) {
        skipped += 1;
        failures.push(row.id);
        continue;
      }

      const { error: updErr } = await admin
        .from('external_properties')
        .update({
          title: copy.title,
          description: copy.description,
          amenities: copy.amenities.length > 0 ? copy.amenities : (row.amenities ?? []),
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);

      if (updErr) {
        console.warn(`[backfill-listing-language] update failed for ${row.id}: ${updErr.message}`);
        skipped += 1;
        failures.push(row.id);
        continue;
      }
      rewritten += 1;
    }

    const result = {
      success: true,
      scanned: rows?.length ?? 0,
      vietnameseFound: candidates.length,
      processed: targets.length,
      rewritten,
      skipped,
      remaining: Math.max(candidates.length - rewritten, 0),
      failures: failures.slice(0, 10),
    };
    console.log('[backfill-listing-language]', JSON.stringify(result));
    return json(result);
  } catch (e) {
    console.error('[backfill-listing-language] error:', e);
    return json({ success: false, error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});
