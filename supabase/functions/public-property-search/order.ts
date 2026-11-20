// The order public-property-search returns listings in, worked out from the
// light columns alone so the heavy ones (images, description, highlights) are
// read only for the page being served.
//
// Until 2026-11-20 the function read every matching listing in full - ~9.5 MB,
// 6.7 MB of it `image_analyses` - to return 25 of them, and the browse table
// and an outside crawler page through the whole catalogue several times a day.
// That was most of the egress that got the project restricted on 2026-11-19.

/** An internal listing: `properties`, newest first. */
export interface InternalLight {
  id: string;
}

/** A crawled listing: `external_properties`, newest first. */
export interface ExternalLight {
  id: string;
  canonical_group_id: string | null;
  image_location_conflict: boolean | null;
}

export type ResultEntry =
  | { table: 'internal'; id: string }
  | { table: 'external'; id: string; posting_count: number };

/**
 * Internal listings first, then crawled ones with each duplicate-unit group
 * collapsed to its first (newest) member and annotated with how many postings
 * it has, then suspected bait (same photos, conflicting location) last.
 */
export function orderResults(internal: InternalLight[], external: ExternalLight[]): ResultEntry[] {
  const out: ResultEntry[] = internal.map((p) => ({ table: 'internal', id: p.id }));

  const groupCounts = new Map<string, number>();
  for (const p of external) {
    if (p.canonical_group_id) {
      groupCounts.set(p.canonical_group_id, (groupCounts.get(p.canonical_group_id) || 0) + 1);
    }
  }
  const seenGroups = new Set<string>();
  const flagged: ResultEntry[] = [];
  for (const p of external) {
    if (p.canonical_group_id) {
      if (seenGroups.has(p.canonical_group_id)) continue;
      seenGroups.add(p.canonical_group_id);
    }
    const entry: ResultEntry = {
      table: 'external',
      id: p.id,
      posting_count: p.canonical_group_id ? (groupCounts.get(p.canonical_group_id) || 1) : 1,
    };
    (p.image_location_conflict ? flagged : out).push(entry);
  }
  out.push(...flagged);
  return out;
}

/**
 * The per-photo highlight strings. Prefers `image_highlights`, the computed
 * field (`public.image_highlights(...)`), and falls back to the full
 * `image_analyses` for a database that does not have it yet.
 */
export function imageHighlightsOf(row: { image_highlights?: unknown; image_analyses?: unknown }): string[] {
  if (Array.isArray(row.image_highlights)) return row.image_highlights.map((h) => String(h ?? ''));
  if (Array.isArray(row.image_analyses)) {
    // deno-lint-ignore no-explicit-any
    return row.image_analyses.map((a: any) => String(a?.image_highlight || a?.highlight || ''));
  }
  return [];
}
