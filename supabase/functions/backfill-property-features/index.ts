// One-time (idempotent) backfill: compute vibe_analysis.features and aggregate
// per-image activities for existing listings, using ONLY data already stored
// (numeric metrics, amenities, highlights, description). No LLM / image calls.
//
// Admin-gated. Processes `properties` and `external_properties` in pages.
// Safe to re-run; recomputes from source each time.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractPropertyFeatures } from "../_shared/property-features.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PAGE = 200;

function aggregateActivities(vibe: any): string[] {
  const set = new Set<string>();
  const imgs = Array.isArray(vibe?.image_analyses) ? vibe.image_analyses : [];
  for (const img of imgs) {
    if (Array.isArray(img?.suggested_activities)) {
      for (const a of img.suggested_activities) if (a) set.add(a);
    }
  }
  return Array.from(set);
}

async function backfillTable(
  supabase: any,
  table: 'properties' | 'external_properties',
): Promise<{ scanned: number; updated: number }> {
  let scanned = 0;
  let updated = 0;
  let from = 0;

  while (true) {
    const { data: rows, error } = await supabase
      .from(table)
      .select('id, title, description, amenities, highlights, vibe_analysis')
      .not('vibe_analysis', 'is', null)
      .range(from, from + PAGE - 1);

    if (error) throw error;
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      scanned++;
      const vibe = (row.vibe_analysis && typeof row.vibe_analysis === 'object') ? row.vibe_analysis : {};

      const features = extractPropertyFeatures({
        metrics: vibe,
        amenities: row.amenities ?? vibe.amenities,
        highlights: row.highlights,
        description: row.description ?? '',
        title: row.title ?? '',
      });

      const nextVibe: any = { ...vibe, features };
      // Only fill activities if missing/empty, so we don't clobber manual entries.
      if (!Array.isArray(vibe.activities) || vibe.activities.length === 0) {
        const acts = aggregateActivities(vibe);
        if (acts.length > 0) nextVibe.activities = acts;
      }

      const { error: updErr } = await supabase
        .from(table)
        .update({ vibe_analysis: nextVibe })
        .eq('id', row.id);

      if (updErr) {
        console.error(`[backfill-features] ${table} ${row.id} update failed:`, updErr.message);
      } else {
        updated++;
      }
    }

    if (rows.length < PAGE) break;
    from += PAGE;
  }

  return { scanned, updated };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const rawAuth = req.headers.get('authorization') || req.headers.get('Authorization');
    const authHeader = rawAuth?.startsWith('Bearer') ? rawAuth : (rawAuth ? `Bearer ${rawAuth}` : undefined);
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: isAdmin } = await supabase.rpc('has_role', { _user_id: user.id, _role: 'admin' });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Admin role required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { tables } = await req.json().catch(() => ({ tables: null }));
    const targets: ('properties' | 'external_properties')[] =
      Array.isArray(tables) && tables.length > 0 ? tables : ['properties', 'external_properties'];

    const results: Record<string, { scanned: number; updated: number }> = {};
    for (const t of targets) {
      console.log(`[backfill-features] processing ${t}…`);
      results[t] = await backfillTable(supabase, t);
      console.log(`[backfill-features] ${t}: ${JSON.stringify(results[t])}`);
    }

    return new Response(JSON.stringify({ success: true, results }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[backfill-features] Error:', error);
    return new Response(JSON.stringify({ error: (error as Error)?.message || 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
