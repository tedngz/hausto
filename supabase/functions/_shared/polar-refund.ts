// What Polar's order.refunded webhook asks of the Pass ledger (the refund
// policy, 2026-10-08).
//
// A refund in full ends the purchase it refunds. record_pass_refund brings that
// row's expires_at forward to the refund, which is how every reader of cover -
// has_active_pass, active_pass_expires_at, usePass - learns of it. Polar is the
// merchant of record and may refund an order itself, within 60 days and
// whatever our policy says, so this is not only our own refunds.
//
// Polar sends order.refunded for a partial refund too. That ends nothing: a
// partial refund is a person's goodwill on a Pass that keeps running, and
// reading it as the end would take cover from someone we meant to keep.
//
// Pure, so it is tested without Deno or a database.

export type RefundDecision =
  | { act: true; checkoutId: string; orderId: string | null; refundedAt: string }
  | { act: false; why: 'PARTIAL' | 'NOT_REFUNDED' | 'NO_CHECKOUT'; orderId: string | null };

export function decideRefund(
  event: { timestamp?: unknown; data?: Record<string, unknown> | null },
  now: Date = new Date(),
): RefundDecision {
  const order = event.data ?? {};
  const orderId = typeof order.id === 'string' ? order.id : null;

  if (order.status === 'partially_refunded') return { act: false, why: 'PARTIAL', orderId };
  if (order.status !== 'refunded') return { act: false, why: 'NOT_REFUNDED', orderId };

  // An order with no checkout behind it was not started by this service, and
  // the checkout id is what a pass row is keyed on.
  const checkoutId = typeof order.checkout_id === 'string' && order.checkout_id ? order.checkout_id : null;
  if (!checkoutId) return { act: false, why: 'NO_CHECKOUT', orderId };

  // When Polar says the refund happened, which a retried delivery carries
  // unchanged - but never later than now, or cover would run on until a clock
  // ahead of ours caught up.
  const stamped = typeof event.timestamp === 'string' ? Date.parse(event.timestamp) : NaN;
  const at = Number.isFinite(stamped) ? Math.min(stamped, now.getTime()) : now.getTime();

  return { act: true, checkoutId, orderId, refundedAt: new Date(at).toISOString() };
}
