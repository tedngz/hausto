import { describe, it, expect } from 'vitest';
import type { DomainEvent, InquiryEvent } from '../viewing-domain.ts';
import { consoleLink, inquiryInboxRow, sortInbox, viewingInboxRow } from './inbox.ts';

const NOW = Date.parse('2026-10-08T10:00:00Z');
let id = 0;
const ev = (type: string, opts: { item?: string; payload?: Record<string, unknown>; at?: string } = {}): DomainEvent => ({
  id: ++id, request_id: 'r1', item_id: opts.item ?? null, type, payload: opts.payload ?? {}, actor: 'SYSTEM',
  occurred_at: opts.at ?? new Date(NOW - 3 * 3_600_000 + id * 1000).toISOString(),
});
const iev = (type: string, at: string, payload: Record<string, unknown> = {}): InquiryEvent =>
  ({ id: ++id, inquiry_id: 'q1', type, payload, actor: 'SYSTEM', occurred_at: at });

describe('viewing requests in the inbox', () => {
  it('ranks by the console queue\'s own triage', () => {
    const row = viewingInboxRow({
      id: 'r1', ref: 'HV-4KX2', createdAt: new Date(NOW - 3 * 3_600_000).toISOString(), now: NOW, proposals: 2,
      events: [ev('REQUEST_SUBMITTED'), ev('ITEM_ADDED', { item: 'i1' })],
    });
    expect(row).toMatchObject({ kind: 'VIEWING', name: 'HV-4KX2', state: 'SUBMITTED', actionable: true, urgency: 'OK' });
    expect(row.waitingOn).toBe('1 broker to contact · 2 AI proposals');
  });

  it('drops a closed request with nothing owed out of the working set', () => {
    const row = viewingInboxRow({
      id: 'r1', ref: 'HV-4KX2', createdAt: new Date(NOW - 3_600_000).toISOString(), now: NOW,
      events: [ev('REQUEST_SUBMITTED'), ev('ITEM_ADDED', { item: 'i1' }), ev('REQUEST_CANCELLED', { payload: { reason: 'OTHER' } })],
    });
    expect(row.actionable).toBe(false);
  });
});

describe('availability requests and priority searches in the inbox', () => {
  const confirmedAt = new Date(NOW - 20 * 3_600_000).toISOString();

  it('runs a building on its 24-hour promise', () => {
    const row = inquiryInboxRow({
      id: 'q1', name: 'Empire City', isSearch: false, createdAt: confirmedAt, now: NOW,
      events: [iev('CONFIRMED', confirmedAt)], lastRenterAt: null, lastOursAt: null,
    });
    expect(row).toMatchObject({ kind: 'BUILDING', state: 'NEW', urgency: 'WARN', actionable: true, waitingOn: 'Nobody asked yet - ask the agents' });
    expect(row.dueAt).toBe(new Date(Date.parse(confirmedAt) + 24 * 3_600_000).toISOString());
  });

  it('gives an area its 48 hours', () => {
    const row = inquiryInboxRow({
      id: 'q1', name: 'Thao Dien', isSearch: true, createdAt: confirmedAt, now: NOW,
      events: [iev('SUBMITTED', confirmedAt, { reply_within_hours: 48 }), iev('CONFIRMED', confirmedAt)],
      lastRenterAt: null, lastOursAt: null,
    });
    expect(row).toMatchObject({ kind: 'SEARCH', urgency: 'OK' });
  });

  it('puts a renter waiting on us first at its urgency', () => {
    const row = inquiryInboxRow({
      id: 'q1', name: 'Empire City', isSearch: false, createdAt: confirmedAt, now: NOW,
      events: [iev('CONFIRMED', confirmedAt), iev('UNITS_OFFERED', confirmedAt, { listing_ids: ['l1'] })],
      lastRenterAt: new Date(NOW - 60_000).toISOString(), lastOursAt: confirmedAt,
    });
    expect(row).toMatchObject({ actionable: true, waitingOn: 'Renter replied - waiting on us' });
  });

  it('leaves units sent, and closed requests, out of the work', () => {
    const offered = inquiryInboxRow({
      id: 'q1', name: 'Empire City', isSearch: false, createdAt: confirmedAt, now: NOW,
      events: [iev('CONFIRMED', confirmedAt), iev('UNITS_OFFERED', confirmedAt, { listing_ids: ['l1'] })],
      lastRenterAt: null, lastOursAt: confirmedAt,
    });
    expect(offered.actionable).toBe(false);
  });
});

describe('one list', () => {
  it('sorts across kinds by urgency, then age', () => {
    const base = { state: 'X', waitingOn: '', urgency: 'OK' as const, actionable: true, dueAt: null, proposals: 0 };
    const rows = sortInbox([
      { ...base, kind: 'VIEWING', id: 'a', name: 'A', rank: 21, createdAt: '2026-10-08T01:00:00Z' },
      { ...base, kind: 'BUILDING', id: 'b', name: 'B', rank: 0, createdAt: '2026-10-08T05:00:00Z' },
      { ...base, kind: 'SEARCH', id: 'c', name: 'C', rank: 21, createdAt: '2026-10-07T01:00:00Z' },
    ]);
    expect(rows.map(r => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('links each kind to its screen in the console', () => {
    expect(consoleLink('VIEWING', 'r1')).toBe('https://hausto-ops.vercel.app/#/request/r1');
    expect(consoleLink('SEARCH', 'q1')).toBe('https://hausto-ops.vercel.app/#/inquiry/q1');
  });
});
