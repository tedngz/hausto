// Returns image-mirroring progress for external_properties.
// Admin-only.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'No authorization' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const { data: isAdmin } = await supabase.rpc('has_role', { _user_id: user.id, _role: 'admin' });
    if (!isAdmin) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data, error } = await supabase.rpc('exec_sql' as any, {}).then(() => ({ data: null, error: null })).catch(() => ({ data: null, error: null }));

    // Fallback: run aggregation via raw SQL through PostgREST is not available;
    // do it in JS by paginating images. Simpler: use a single query with rpc-less aggregation.
    // We'll fetch row-level summaries in chunks.
    const PAGE = 1000;
    let from = 0;
    let totalRows = 0, activeRows = 0, rawRows = 0;
    let totalImages = 0, mirroredImages = 0, remoteImages = 0;
    let rowsWithUnmirrored = 0, activeRowsWithUnmirrored = 0;

    while (true) {
      const { data: rows, error: e } = await supabase
        .from('external_properties')
        .select('is_active, raw_only, images')
        .not('images', 'is', null)
        .range(from, from + PAGE - 1);
      if (e) throw e;
      if (!rows || rows.length === 0) break;

      for (const r of rows as any[]) {
        const imgs: string[] = Array.isArray(r.images) ? r.images : [];
        if (imgs.length === 0) continue;
        totalRows += 1;
        if (r.is_active) activeRows += 1;
        if (r.raw_only) rawRows += 1;
        let unmirroredInRow = 0;
        for (const u of imgs) {
          totalImages += 1;
          if (u && u.includes('/external-property-images/')) mirroredImages += 1;
          else { remoteImages += 1; unmirroredInRow += 1; }
        }
        if (unmirroredInRow > 0) {
          rowsWithUnmirrored += 1;
          if (r.is_active) activeRowsWithUnmirrored += 1;
        }
      }

      if (rows.length < PAGE) break;
      from += PAGE;
    }

    return new Response(JSON.stringify({
      success: true,
      totals: {
        rows_with_images: totalRows,
        active_rows: activeRows,
        raw_rows: rawRows,
        total_images: totalImages,
        mirrored_images: mirroredImages,
        remote_images: remoteImages,
        rows_with_unmirrored: rowsWithUnmirrored,
        active_rows_with_unmirrored: activeRowsWithUnmirrored,
        mirrored_pct: totalImages ? Math.round((mirroredImages / totalImages) * 1000) / 10 : 0,
      },
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('[mirror-status] fatal:', e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
