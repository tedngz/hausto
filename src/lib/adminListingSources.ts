import { supabase } from '@/integrations/supabase/client';

// A crawled listing's source link and the crawler's `raw_data`, for the admin
// screens only.
//
// Neither is selected from the table any more: the source ad carries the
// agent's number, so `source_url` is not readable by renters (CLAUDE.md
// invariant 4), and admins sign in as the same `authenticated` role.
// `admin_external_listing_sources` answers admins and returns no rows to anyone
// else, so a non-admin caller simply gets nulls.
export async function withAdminSources<T extends { id: string }>(
  rows: T[],
): Promise<(T & { source_url: string | null; raw_data: unknown })[]> {
  if (rows.length === 0) return [];
  const { data, error } = await supabase.rpc('admin_external_listing_sources', {
    _ids: rows.map(r => r.id),
  });
  if (error) console.warn('[admin] listing sources unavailable:', error.message);
  const byId = new Map<string, { source_url: string | null; raw_data: unknown }>(
    (data ?? []).map(r => [r.id, { source_url: r.source_url, raw_data: r.raw_data }]),
  );
  return rows.map(r => ({
    ...r,
    source_url: byId.get(r.id)?.source_url ?? null,
    raw_data: byId.get(r.id)?.raw_data ?? null,
  }));
}
