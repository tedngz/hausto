// The WhatsApp number's own standing with Meta, beside its templates'.
//
// Meta rates the number as well as each template - GREEN, YELLOW or RED - from
// how recipients treat what it sends: blocks and reports, mostly. Marketing is
// what moves it, and the Pass digest is the first marketing this number sends
// at any volume. A number that falls far enough has its messaging limited, and
// the itineraries, lock-in links and morning-of messages all go out from it.
//
// So whatsapp-template-sync reads the rating every hour into
// `whatsapp_number_status`, the ops console shows it, and the digest sweep
// holds itself while the reading says anything is wrong. The hold lifts by
// itself when a later reading comes back GREEN; nobody has to remember it.
//
// Pure apart from the one read, so the rules are testable without a WABA.

// deno-lint-ignore no-explicit-any
type Supa = any;

export interface NumberHealth {
  /** GREEN | YELLOW | RED, or NA / UNKNOWN for a number Meta has not rated. */
  qualityRating: string;
  /** CONNECTED, FLAGGED, RESTRICTED... - null when Meta did not say. */
  status: string | null;
}

/** What `whatsapp_number_status` keeps, as the digest and the console read it. */
export interface NumberStatusRow {
  quality_rating: string | null;
  status: string | null;
  checked_at?: string | null;
  previous_rating?: string | null;
  rating_changed_at?: string | null;
  last_error?: string | null;
}

/**
 * Pull the reading out of a `GET /{phone-number-id}` response. Defensive about
 * shape, like parseMetaTemplates: a renamed field reads as UNKNOWN, which holds
 * nothing, rather than throwing inside an hourly cron.
 */
// deno-lint-ignore no-explicit-any
export function parseNumberHealth(payload: any): NumberHealth {
  const upper = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().toUpperCase() : null);
  return { qualityRating: upper(payload?.quality_rating) ?? 'UNKNOWN', status: upper(payload?.status) };
}

/**
 * Why marketing should wait, or null when it may go.
 *
 * Only a reading that says something is wrong holds it. A number Meta has not
 * rated, or a sync that has not run yet, sends as before - the hold protects
 * the number from us, not us from a missing reading.
 */
export function marketingHold(row: Pick<NumberStatusRow, 'quality_rating' | 'status'> | null): string | null {
  if (!row) return null;
  const rating = (row.quality_rating ?? '').toUpperCase();
  const status = (row.status ?? '').toUpperCase();
  if (rating === 'YELLOW' || rating === 'RED') return `Meta rates the number ${rating}`;
  if (status === 'FLAGGED' || status === 'RESTRICTED') return `Meta has ${status.toLowerCase()} the number`;
  return null;
}

/**
 * The upsert for one reading. `previous_rating` and `rating_changed_at` move
 * only when the rating does, so the console can say since when.
 */
export function numberStatusRow(h: NumberHealth, previousRating: string | null, now: Date): Record<string, unknown> {
  const at = now.toISOString();
  const row: Record<string, unknown> = {
    id: 'singleton', quality_rating: h.qualityRating, status: h.status, checked_at: at, last_error: null, updated_at: at,
  };
  if (previousRating !== h.qualityRating) {
    row.previous_rating = previousRating;
    row.rating_changed_at = at;
  }
  return row;
}

/** The last reading, or null before the first sync. */
export async function readNumberStatus(db: Supa): Promise<NumberStatusRow | null> {
  const { data } = await db
    .from('whatsapp_number_status')
    .select('quality_rating, status, checked_at, previous_rating, rating_changed_at, last_error')
    .eq('id', 'singleton')
    .maybeSingle();
  return (data as NumberStatusRow | null) ?? null;
}
