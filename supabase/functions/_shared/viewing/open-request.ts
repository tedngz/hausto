// Finding the request a new place should join (intake.ts `pickJoinable`).
//
// Read by two functions: `viewing-request-open`, so the modal can say "adding
// to HV-4KX2" before the renter commits, and `viewing-request-create`, which
// decides again at submit rather than trusting what the modal was shown. The
// reading lives here so the two cannot disagree about which request is open.
//
// State is reduced from the log, server-side, because the browser cannot read
// `events` (it carries operator notes and agent outcomes) and a status column
// would be invariant 1 broken.

import { reduceRequest, type DomainEvent } from '../viewing-domain.ts';
import {
  MAX_DAYS_AHEAD,
  pickJoinable,
  type AvailabilityWindow,
  type JoinCandidate,
} from './intake.ts';

// deno-lint-ignore no-explicit-any
type Supa = any;

export interface OpenRequest extends JoinCandidate {
  renterId: string;
  optedOut: boolean;
}

/**
 * The signed-in account's joinable request, or null.
 *
 * Keyed on `renters.user_id`, not on a phone number: the account is what gets
 * charged for the place, and an account can have reached us from more than one
 * number. Only requests young enough to still have an offerable window are
 * read - anything older than `MAX_DAYS_AHEAD` has none by construction.
 */
export async function findJoinableRequest(
  db: Supa,
  userId: string,
  today: string,
  now: Date = new Date(),
): Promise<OpenRequest | null> {
  const since = new Date(now.getTime() - (MAX_DAYS_AHEAD + 1) * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await db
    .from('viewing_requests')
    .select('id, ref, created_at, availability, renter_id, renters!inner(user_id, opted_out_at), request_items(listing_id)')
    .eq('renters.user_id', userId)
    .gte('created_at', since)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`open request lookup failed: ${error.message ?? error}`);
  const requests = (rows ?? []) as {
    id: string;
    ref: string;
    created_at: string;
    availability: unknown;
    renter_id: string;
    renters: { opted_out_at: string | null } | null;
    request_items: { listing_id: string }[] | null;
  }[];
  if (requests.length === 0) return null;

  const { data: evRows, error: evErr } = await db
    .from('events')
    .select('id, request_id, item_id, type, payload, actor, occurred_at')
    .in('request_id', requests.map(r => r.id));
  if (evErr) throw new Error(`open request events failed: ${evErr.message ?? evErr}`);
  const events = (evRows ?? []) as DomainEvent[];

  const candidates: OpenRequest[] = requests.map(r => {
    const view = reduceRequest(r.id, events.filter(e => e.request_id === r.id));
    return {
      requestId: r.id,
      ref: r.ref,
      createdAt: r.created_at,
      availability: Array.isArray(r.availability) ? r.availability as AvailabilityWindow[] : [],
      listingIds: (r.request_items ?? []).map(i => i.listing_id),
      state: view.state,
      delivered: !!view.deliveredMessageId,
      renterId: r.renter_id,
      optedOut: !!r.renters?.opted_out_at,
    };
  });

  // An opted-out number is not one we can deliver the joined plan to, so its
  // requests do not count as open for this purpose.
  return pickJoinable(candidates.filter(c => !c.optedOut), today) as OpenRequest | null;
}
