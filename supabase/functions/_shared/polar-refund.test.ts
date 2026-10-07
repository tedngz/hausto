import { describe, it, expect } from 'vitest';
import { decideRefund } from './polar-refund.ts';

const NOW = new Date('2026-10-08T05:00:00.000Z');

// The fields of Polar's Order that matter here (WebhookOrderRefundedPayload,
// OpenAPI 2026-10). Everything else in the payload is ignored.
const refunded = (over: Record<string, unknown> = {}) => ({
  type: 'order.refunded',
  timestamp: '2026-10-08T04:59:00.000Z',
  data: {
    id: 'order-1',
    status: 'refunded',
    checkout_id: 'checkout-1',
    total_amount: 2500,
    refunded_amount: 2500,
    ...over,
  },
});

describe('a refund in full', () => {
  it('ends the pass bought through its checkout, as of the refund', () => {
    expect(decideRefund(refunded(), NOW)).toEqual({
      act: true,
      checkoutId: 'checkout-1',
      orderId: 'order-1',
      refundedAt: '2026-10-08T04:59:00.000Z',
    });
  });

  it('keeps the time Polar stamped on a delivery retried hours later', () => {
    const later = new Date('2026-10-08T09:00:00.000Z');
    const d = decideRefund(refunded(), later);
    expect(d.act && d.refundedAt).toBe('2026-10-08T04:59:00.000Z');
  });

  it('never dates a refund in the future', () => {
    const d = decideRefund({ ...refunded(), timestamp: '2026-10-09T00:00:00.000Z' }, NOW);
    expect(d.act && d.refundedAt).toBe(NOW.toISOString());
  });

  it('falls back to now without a readable timestamp', () => {
    for (const timestamp of [undefined, 'not a date', 1791282891]) {
      const d = decideRefund({ ...refunded(), timestamp }, NOW);
      expect(d.act && d.refundedAt).toBe(NOW.toISOString());
    }
  });
});

describe('what ends nothing', () => {
  it('a partial refund - the Pass keeps running', () => {
    expect(decideRefund(refunded({ status: 'partially_refunded', refunded_amount: 1000 }), NOW))
      .toEqual({ act: false, why: 'PARTIAL', orderId: 'order-1' });
  });

  it('an order that is not refunded', () => {
    for (const status of ['paid', 'pending', 'void', undefined]) {
      expect(decideRefund(refunded({ status }), NOW)).toMatchObject({ act: false, why: 'NOT_REFUNDED' });
    }
  });

  it('an order no checkout of ours started', () => {
    for (const checkout_id of [null, undefined, '']) {
      expect(decideRefund(refunded({ checkout_id }), NOW)).toMatchObject({ act: false, why: 'NO_CHECKOUT' });
    }
  });

  it('a payload with no order at all', () => {
    expect(decideRefund({ timestamp: '2026-10-08T04:59:00.000Z' }, NOW))
      .toEqual({ act: false, why: 'NOT_REFUNDED', orderId: null });
    expect(decideRefund({ data: null }, NOW))
      .toEqual({ act: false, why: 'NOT_REFUNDED', orderId: null });
  });
});
