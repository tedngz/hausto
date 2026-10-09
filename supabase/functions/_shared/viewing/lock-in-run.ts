// Reading and writing a lock-in (lock-in.ts decides; this does the I/O).
//
// Three callers, one implementation, so they cannot drift:
//   - `viewing-lock-in`, the page: shows the plan, locks it in with the Pass
//     the renter holds or with their free viewing;
//   - `_shared/polar-pass.ts`, when a Pass bought from that page is recorded -
//     by the redirect or the webhook, whichever is first - so a renter who
//     pays and closes the tab keeps the plan;
//   - `routing.ts`, when a Pass holder replies "yes" on WhatsApp.
//
// The plan as a renter sees it carries no agent field (SPEC §9): showing it
// before payment gives nothing away.

import { reduceRequest, type Cover, type DomainEvent, type RequestView } from '../viewing-domain.ts';
import {
  checkoutHonoured,
  decideLockIn,
  lockableStops,
  lockInDeadline,
  lockInStatus,
  passLiveAt,
  type LockInChoice,
  type LockInDecision,
  type LockInRefusal,
  type LockInStatus,
} from './lock-in.ts';

// deno-lint-ignore no-explicit-any
type Supa = any;

/** One stop of the plan, as the renter sees it. No realtor field, on purpose. */
export interface PlanStop {
  itemId: string;
  title: string;
  districtCode: string | null;
  priceVnd: number;
  startsAt: string;
}

export interface LockInContext {
  requestId: string;
  ref: string;
  renterId: string;
  /** The account the request belongs to. A WhatsApp-only renter has none. */
  userId: string | null;
  /** When the request was made: a Pass live then covers the plan (`planPassCover`). */
  requestedAt: string;
  phoneE164: string;
  view: RequestView;
  stops: PlanStop[];
  deadline: string | null;
  status: LockInStatus;
}

/** The request, reduced, with its plan. Null for an unknown ref or id. */
export async function loadLockIn(
  db: Supa,
  key: { ref?: string; requestId?: string },
  now: number,
): Promise<LockInContext | null> {
  let q = db.from('viewing_requests').select('id, ref, renter_id, created_at');
  q = key.requestId ? q.eq('id', key.requestId) : q.eq('ref', String(key.ref ?? ''));
  const { data: request } = await q.maybeSingle();
  if (!request) return null;

  const [{ data: renter }, { data: events }, { data: items }] = await Promise.all([
    db.from('renters').select('id, phone_e164, user_id').eq('id', request.renter_id).maybeSingle(),
    db.from('events').select('id, request_id, item_id, type, payload, actor, occurred_at')
      .eq('request_id', request.id).order('occurred_at', { ascending: true }),
    db.from('ops_request_items_view').select('id, listing_title, district_code, price_vnd_at_request')
      .eq('request_id', request.id),
  ]);
  if (!renter) return null;

  const view = reduceRequest(request.id, (events ?? []) as DomainEvent[]);
  const byItem = new Map(((items ?? []) as Record<string, unknown>[]).map(i => [String(i.id), i]));
  const stops: PlanStop[] = lockableStops(view).map(s => {
    const i = byItem.get(s.itemId) ?? {};
    return {
      itemId: s.itemId,
      title: String(i.listing_title ?? 'A place'),
      districtCode: (i.district_code as string | null) ?? null,
      priceVnd: Number(i.price_vnd_at_request ?? 0),
      startsAt: s.startsAt,
    };
  });

  return {
    requestId: String(request.id),
    ref: String(request.ref),
    renterId: String(renter.id),
    userId: (renter.user_id as string | null) ?? null,
    requestedAt: String(request.created_at),
    phoneE164: String(renter.phone_e164),
    view,
    stops,
    deadline: lockInDeadline(view),
    status: lockInStatus(view, now),
  };
}

/** A live Pass, bought or complimentary (an admin's). */
export async function hasPassCover(db: Supa, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const [{ data: bought }, { data: complimentary }] = await Promise.all([
    db.rpc('has_active_pass', { _user_id: userId }),
    db.rpc('has_complimentary_pass', { _user_id: userId }),
  ]);
  return bought === true || complimentary === true;
}

/**
 * Does the Pass cover this plan? A live one does, and so does one that was
 * live when the request was made (lock-in.ts `passLiveAt`). Everything that
 * decides how a plan locks in asks this rather than `hasPassCover`: the page,
 * the payment, a "yes" on WhatsApp, and the plan's own last line.
 */
export async function planPassCover(
  db: Supa,
  plan: { userId: string | null; requestedAt: string },
): Promise<boolean> {
  if (!plan.userId) return false;
  if (await hasPassCover(db, plan.userId)) return true;
  const { data, error } = await db.from('passes')
    .select('purchased_at, expires_at, refunded_at')
    .eq('renter_id', plan.userId)
    .eq('kind', 'pass');
  // As before this existed: the live Pass alone. A WhatsApp "yes" must not
  // fail on a read that only ever widens cover.
  if (error) {
    console.error('[lock-in] passes read failed:', error);
    return false;
  }
  return passLiveAt(
    ((data ?? []) as Record<string, unknown>[]).map(p => ({
      purchasedAt: String(p.purchased_at),
      expiresAt: String(p.expires_at),
      refundedAt: (p.refunded_at as string | null) ?? null,
    })),
    plan.requestedAt,
  );
}

/** Has this WhatsApp number had its free viewing? Once per number, not per account. */
export async function freeViewingAvailable(db: Supa, phoneE164: string): Promise<boolean> {
  const { data } = await db.from('free_viewings').select('phone_e164').eq('phone_e164', phoneE164).maybeSingle();
  return !data;
}

export type LockInResult =
  | { ok: true; cover: Cover; confirmedItemIds: string[]; already: boolean }
  | { ok: false; reason: LockInRefusal | 'NOT_OPEN' | 'NOT_YOURS' | 'WRITE_FAILED'; status?: LockInStatus };

/**
 * Lock a plan in, if it may be. Writes REQUEST_CONFIRMED with how it was
 * covered; a free viewing is claimed first, on the number's unique row, so two
 * tabs cannot spend one free viewing twice.
 *
 * `allowPaying` lets a payment through after the deadline when its checkout
 * was opened in time (lock-in.ts `checkoutHonoured`); the page never passes it.
 */
export async function lockIn(
  db: Supa,
  ctx: LockInContext,
  opts: { userId: string; choice: LockInChoice; actor: string; now: number; checkoutId?: string },
): Promise<LockInResult> {
  if (ctx.userId !== opts.userId) return { ok: false, reason: 'NOT_YOURS' };
  if (ctx.status === 'LOCKED_IN') {
    return {
      ok: true,
      cover: ctx.view.confirmedCover ?? 'PASS',
      confirmedItemIds: ctx.view.confirmedItemIds,
      already: true,
    };
  }
  const honoured = ctx.status === 'OPEN'
    || (!!opts.checkoutId && (ctx.status === 'PAYING' || ctx.status === 'LAPSED')
      && checkoutHonoured(ctx.view, opts.checkoutId));
  if (!honoured) return { ok: false, reason: 'NOT_OPEN', status: ctx.status };

  const [hasPass, freeAvailable] = await Promise.all([
    planPassCover(db, ctx),
    freeViewingAvailable(db, ctx.phoneE164),
  ]);
  const decision: LockInDecision = decideLockIn({
    stopItemIds: ctx.stops.map(s => s.itemId),
    hasPass,
    freeViewingAvailable: freeAvailable,
    choice: opts.choice,
  });
  if (!decision.ok) return { ok: false, reason: decision.reason };

  if (decision.cover === 'FREE_VIEWING') {
    const { error } = await db.from('free_viewings').insert({
      phone_e164: ctx.phoneE164,
      user_id: ctx.userId,
      request_id: ctx.requestId,
      item_id: decision.confirmedItemIds[0],
    });
    // Another lock-in on this number got there first.
    if (error) return { ok: false, reason: error.code === '23505' ? 'FREE_VIEWING_USED' : 'WRITE_FAILED' };
  }

  const { error: evErr } = await db.from('events').insert({
    request_id: ctx.requestId,
    type: 'REQUEST_CONFIRMED',
    payload: {
      confirmed_item_ids: decision.confirmedItemIds,
      cover: decision.cover,
      ...(opts.checkoutId ? { checkout_id: opts.checkoutId } : {}),
    },
    actor: opts.actor,
    occurred_at: new Date(opts.now).toISOString(),
  });
  if (evErr) {
    // A claimed free viewing with no lock-in behind it would be a free
    // viewing spent on nothing.
    if (decision.cover === 'FREE_VIEWING') {
      await db.from('free_viewings').delete().eq('phone_e164', ctx.phoneE164).eq('request_id', ctx.requestId);
    }
    return { ok: false, reason: 'WRITE_FAILED' };
  }
  return { ok: true, cover: decision.cover, confirmedItemIds: decision.confirmedItemIds, already: false };
}

/**
 * After a Pass bought from the lock-in page is recorded: lock its plan in.
 * Called from both purchase paths, so it is idempotent - the second finds the
 * plan already locked in and says so.
 */
export async function lockInAfterPurchase(
  db: Supa,
  opts: { requestId: string; checkoutId: string; userId: string; now?: number },
): Promise<LockInResult | { ok: false; reason: 'UNKNOWN_REQUEST' }> {
  const now = opts.now ?? Date.now();
  const ctx = await loadLockIn(db, { requestId: opts.requestId }, now);
  if (!ctx) return { ok: false, reason: 'UNKNOWN_REQUEST' };
  return lockIn(db, ctx, {
    userId: opts.userId,
    choice: { cover: 'PASS' },
    actor: 'RENTER',
    now,
    checkoutId: opts.checkoutId,
  });
}
