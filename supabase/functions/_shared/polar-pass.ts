import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { lockInAfterPurchase, type LockInResult } from "./viewing/lock-in-run.ts";

// Recording a paid Polar checkout as a pass or top-up.
//
// Two things call this: capture-pass-order, when the renter lands back on
// /pass-success, and handle-polar-webhooks, when Polar reports order.paid. They
// race, and either can arrive first - a renter who closes the tab the moment
// they pay never runs the first one at all, which is the whole reason the
// webhook exists.
//
// So the routine lives here rather than in either caller. The expiry arithmetic
// below is the part that must not be reimplemented twice: a pass extends live
// cover, a top-up hangs off it and never extends anything, and getting that
// wrong in one path only would hand out days nobody paid for.

export const PASS_DAYS = 30;
// Written on every pass row, and read by nothing since the pricing rework: the
// Pass covers every confirmed viewing for its 30 days (SPEC §9), so the count
// is history. The top-up is retired and no longer sold; one bought before
// that still records here.
export const PASS_VIEWINGS = 3;
export const TOPUP_VIEWINGS = 2;

export type PassKind = 'pass' | 'topup';

/** The plan a Pass was bought to lock in, and what became of it. */
export type PurchaseLockIn = { ref: string | null; result: LockInResult | { ok: false; reason: 'UNKNOWN_REQUEST' } };

export type RecordResult =
  /** Written just now. */
  | { status: 'recorded'; kind: PassKind; viewings: number; expiresAt: string; lockIn?: PurchaseLockIn }
  /** The other path got there first, or this is a redelivery. */
  | { status: 'already'; kind: PassKind; viewings: number; expiresAt: string; lockIn?: PurchaseLockIn }
  /** Polar has not marked the checkout succeeded yet. Nothing written. */
  | { status: 'pending'; checkoutStatus: string };

interface RecordArgs {
  supabase: SupabaseClient;
  apiBase: string;
  accessToken: string;
  checkoutId: string;
  /**
   * The signed-in renter, when a browser is driving. Their claim on the
   * checkout is verified against it. The webhook has no session, so it omits
   * this and trusts the checkout's own metadata - which this service set when
   * it opened the session, and reads back from Polar rather than from a caller.
   */
  expectedRenterId?: string;
  /**
   * How many times to re-read a checkout that is still settling. Polar moves a
   * session through `confirmed` before `succeeded`, so the browser waits a
   * moment rather than reporting failure to someone who has just paid. The
   * webhook passes 1: it must answer inside Polar's 2-second budget, and a
   * retry there is Polar's job, not a held connection.
   */
  attempts?: number;
  log?: (step: string, details?: unknown) => void;
}

const SETTLE_DELAY_MS = 1000;

/** What the ledger already holds for this checkout, if anything. */
async function existingPass(supabase: SupabaseClient, checkoutId: string) {
  const { data } = await supabase
    .from('passes')
    .select('id, kind, viewings_included, expires_at, renter_id')
    .eq('provider_order_id', checkoutId)
    .maybeSingle();
  return data;
}

/**
 * The request a checkout was opened to lock in, from its log
 * (LOCK_IN_CHECKOUT_OPENED, written by create-pass-order before the renter was
 * sent to pay). Read from the log rather than the checkout's metadata so the
 * second path to arrive - which never fetches the checkout - finds it too.
 */
async function lockInRequestFor(supabase: SupabaseClient, checkoutId: string) {
  const { data } = await supabase
    .from('events')
    .select('request_id')
    .eq('type', 'LOCK_IN_CHECKOUT_OPENED')
    .eq('payload->>checkout_id', checkoutId)
    .limit(1)
    .maybeSingle();
  if (!data?.request_id) return null;
  const { data: req } = await supabase.from('viewing_requests').select('id, ref').eq('id', data.request_id).maybeSingle();
  return req ? { id: String(req.id), ref: String(req.ref) } : null;
}

/**
 * Lock in the plan this Pass was bought for, if it was bought for one. Both
 * purchase paths run it - idempotent, the second finds it locked in - so a
 * renter who pays and closes the tab keeps the plan. Never throws: the Pass is
 * paid for and recorded whatever happens to the plan, and a person sorts out a
 * plan that could not be kept (Before launch: the refund policy).
 */
async function lockInPurchasedPlan(
  supabase: SupabaseClient,
  checkoutId: string,
  renterId: string,
  log: (step: string, details?: unknown) => void,
): Promise<PurchaseLockIn | undefined> {
  try {
    const request = await lockInRequestFor(supabase, checkoutId);
    if (!request) return undefined;
    const result = await lockInAfterPurchase(supabase, { requestId: request.id, checkoutId, userId: renterId });
    log(result.ok ? 'Plan locked in' : 'Plan not locked in', { ref: request.ref, ...result });
    return { ref: request.ref, result };
  } catch (e) {
    log('Lock-in after purchase failed', { checkoutId, message: (e as Error).message });
    return undefined;
  }
}

/**
 * Confirm a checkout with Polar and write the purchase it paid for.
 *
 * Idempotent on passes.provider_order_id, which is the checkout id from both
 * callers - so whichever arrives second finds the row and reports it rather
 * than granting a second pass.
 */
export async function recordPolarPurchase(args: RecordArgs): Promise<RecordResult> {
  const { supabase, apiBase, accessToken, checkoutId, expectedRenterId } = args;
  const attempts = args.attempts ?? 1;
  const log = args.log ?? (() => {});

  const already = await existingPass(supabase, checkoutId);
  if (already) {
    log('Checkout already recorded', { passId: already.id });
    return {
      status: 'already',
      kind: already.kind as PassKind,
      viewings: already.viewings_included,
      expiresAt: already.expires_at,
      lockIn: already.renter_id
        ? await lockInPurchasedPlan(supabase, checkoutId, String(already.renter_id), log)
        : undefined,
    };
  }

  let checkout: Record<string, unknown> | null = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = await fetch(`${apiBase}/v1/checkouts/${checkoutId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(`Polar checkout lookup failed: ${JSON.stringify(data)}`);
    }
    checkout = data;
    if (data.status === 'succeeded') break;
    if (data.status === 'expired' || data.status === 'failed') {
      throw new Error(`Checkout did not complete: ${data.status}`);
    }
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, SETTLE_DELAY_MS));
    }
  }

  if (checkout?.status !== 'succeeded') {
    log('Checkout not settled yet', { checkoutId, status: checkout?.status });
    return { status: 'pending', checkoutStatus: String(checkout?.status ?? 'unknown') };
  }

  // Set by create-pass-order, so this is our own statement of what was sold,
  // not the buyer's. Price is Polar's to set, so it is recorded rather than
  // used to infer the product - a price change in the dashboard must not
  // silently turn a pass into a top-up.
  const metadata = (checkout.metadata ?? {}) as Record<string, unknown>;
  const kind = metadata.kind as PassKind | undefined;
  if (kind !== 'pass' && kind !== 'topup') {
    throw new Error(`Unrecognised checkout metadata kind: ${String(kind)}`);
  }

  // Who it was bought for. metadata.renter_id and external_customer_id are both
  // set at creation from the same user id; either identifies the renter.
  const renterId = (metadata.renter_id as string | undefined)
    ?? (checkout.external_customer_id as string | undefined);
  if (!renterId) {
    throw new Error('Checkout carries no renter to credit');
  }
  if (expectedRenterId && renterId !== expectedRenterId) {
    throw new Error('Checkout does not belong to this user');
  }

  // Polar reports money in minor units. `amount` is the product price; the tax
  // it collects on top is Polar's to remit, not Hausto revenue.
  const amountUsd = Number(checkout.amount ?? NaN) / 100;
  if (!Number.isFinite(amountUsd)) {
    throw new Error('Could not read the amount from Polar');
  }

  // Both kinds hang off whatever cover is already live.
  const { data: passExpiry, error: expiryError } = await supabase
    .rpc('active_pass_expires_at', { _user_id: renterId });
  if (expiryError) throw expiryError;

  let expiresAt: string;
  if (kind === 'pass') {
    // A pass bought while one is live extends it rather than overlapping it:
    // 30 days is what was paid for, so buying early must not burn the days
    // still left on the current pass.
    const from = passExpiry ? new Date(passExpiry as string).getTime() : Date.now();
    expiresAt = new Date(from + PASS_DAYS * 24 * 60 * 60 * 1000).toISOString();
  } else {
    // A top-up lapses with the pass that allowed it, so it never extends cover
    // on its own. Without a live pass there's nothing to attach it to - except
    // a complimentary pass, which is live but has no end date, so its top-up
    // gets its own 30-day window rather than failing after payment.
    if (passExpiry) {
      expiresAt = new Date(passExpiry as string).toISOString();
    } else {
      const { data: complimentary, error: complimentaryError } = await supabase
        .rpc('has_complimentary_pass', { _user_id: renterId });
      if (complimentaryError) throw complimentaryError;
      if (!complimentary) {
        throw new Error('No live pass to attach this top-up to');
      }
      expiresAt = new Date(Date.now() + PASS_DAYS * 24 * 60 * 60 * 1000).toISOString();
    }
  }

  const viewings = kind === 'pass' ? PASS_VIEWINGS : TOPUP_VIEWINGS;

  // One row per purchase - the window is extended via expires_at above, so this
  // is always an insert, never an upsert onto an existing pass.
  const { error: insertError } = await supabase.from('passes').insert({
    renter_id: renterId,
    kind,
    provider: 'polar',
    provider_order_id: checkoutId,
    amount_usd: amountUsd,
    viewings_included: viewings,
    expires_at: expiresAt,
  });

  if (insertError) {
    // Unique violation on provider_order_id means the other path won the race
    // between the read at the top and this insert. Report what it wrote.
    const raced = await existingPass(supabase, checkoutId);
    if (raced) {
      log('Lost the race to the other path', { passId: raced.id });
      return {
        status: 'already',
        kind: raced.kind as PassKind,
        viewings: raced.viewings_included,
        expiresAt: raced.expires_at,
        lockIn: await lockInPurchasedPlan(supabase, checkoutId, renterId, log),
      };
    }
    throw insertError;
  }

  log('Purchase recorded', { renterId, kind, expiresAt });
  return {
    status: 'recorded', kind, viewings, expiresAt,
    lockIn: kind === 'pass' ? await lockInPurchasedPlan(supabase, checkoutId, renterId, log) : undefined,
  };
}
