import { describe, it, expect } from 'vitest';
import { verificationDueFilter } from './verify-due.ts';

// The filter is PostgREST syntax; this reads it back as a predicate over a
// row, so the cases below say which listings a run would pick.
type Row = {
  source: string;
  last_verified_at: string | null;
  crawled_at: string;
  verification_failures?: number;
  price_confirmed_at?: string | null;
  terms_read_at?: string | null;
};

function evaluate(filter: string, row: Row): boolean {
  // Split the top-level `or` on commas outside parentheses.
  const parts: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < filter.length; i++) {
    if (filter[i] === '(') depth++;
    else if (filter[i] === ')') depth--;
    else if (filter[i] === ',' && depth === 0) { parts.push(filter.slice(start, i)); start = i + 1; }
  }
  parts.push(filter.slice(start));
  return parts.some((p) => clause(p, row));
}

function clause(p: string, row: Row): boolean {
  const and = p.match(/^and\((.*)\)$/);
  if (and) {
    const inner: string[] = [];
    let depth = 0, start = 0;
    for (let i = 0; i < and[1].length; i++) {
      const ch = and[1][i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ',' && depth === 0) { inner.push(and[1].slice(start, i)); start = i + 1; }
    }
    inner.push(and[1].slice(start));
    return inner.every((c) => clause(c, row));
  }
  const m = p.match(/^(\w+)\.(is|lte|gte|in)\.(.*)$/);
  if (!m) throw new Error(`unread clause: ${p}`);
  const [, col, op, arg] = m;
  const v = (row as Record<string, unknown>)[col] ?? null;
  if (op === 'is') return v === null;
  if (op === 'in') return arg.slice(1, -1).split(',').includes(String(v));
  if (v === null) return false;
  if (col === 'verification_failures') return op === 'gte' ? Number(v) >= Number(arg) : Number(v) <= Number(arg);
  const t = Date.parse(String(v)), a = Date.parse(arg);
  return op === 'lte' ? t <= a : t >= a;
}

const NOW = Date.parse('2026-10-27T03:00:00Z');
const REREAD = ['nhatot', 'rentapartment', 'vnrenthome', 'jhouse'];
const due = (row: Row) => evaluate(verificationDueFilter(NOW, REREAD), row);
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

describe('which listings a run checks', () => {
  it('a listing never verified', () => {
    expect(due({ source: 'housingsgn', last_verified_at: null, crawled_at: ago(1) })).toBe(true);
  });

  it('a source a check cannot re-read: from its last sighting, as before', () => {
    expect(due({ source: 'housingsgn', last_verified_at: ago(1), crawled_at: ago(10) })).toBe(false);
    expect(due({ source: 'housingsgn', last_verified_at: ago(3), crawled_at: ago(10) })).toBe(true);
    expect(due({ source: 'housingsgn', last_verified_at: ago(3), crawled_at: ago(60) })).toBe(false);
    expect(due({ source: 'housingsgn', last_verified_at: ago(6), crawled_at: ago(60) })).toBe(true);
  });

  it('a re-read source stamped by a crawl yesterday is still due, on its last price read', () => {
    // The 2026-10-26 case: seen in the jhouse feed at 12:30, never checked since crawling.
    const row = { source: 'jhouse', last_verified_at: ago(0.5), crawled_at: ago(11), price_confirmed_at: ago(11), terms_read_at: ago(0.2) };
    expect(due(row)).toBe(true);
    expect(due({ ...row, price_confirmed_at: ago(1) })).toBe(false);
    // Past the lease window, the slower tier.
    expect(due({ ...row, crawled_at: ago(60), price_confirmed_at: ago(4) })).toBe(false);
    expect(due({ ...row, crawled_at: ago(60), price_confirmed_at: ago(6) })).toBe(true);
  });

  it('never price-confirmed counts from the crawl, so a fresh listing is not checked at once', () => {
    const row = { source: 'nhatot', last_verified_at: ago(0.1), price_confirmed_at: null, terms_read_at: ago(0.1) };
    expect(due({ ...row, crawled_at: ago(1) })).toBe(false);
    expect(due({ ...row, crawled_at: ago(3) })).toBe(true);
  });

  it('a re-read source never read for lease terms is due now', () => {
    expect(due({ source: 'rentapartment', last_verified_at: ago(0.1), crawled_at: ago(5), price_confirmed_at: ago(0.1), terms_read_at: null })).toBe(true);
    // Not for a source a check cannot read them from.
    expect(due({ source: 'housingsgn', last_verified_at: ago(0.1), crawled_at: ago(5), terms_read_at: null })).toBe(false);
  });

  it('a failure on record is confirmed within hours', () => {
    expect(due({ source: 'housingsgn', last_verified_at: ago(0.3), crawled_at: ago(10), verification_failures: 1 })).toBe(true);
    expect(due({ source: 'housingsgn', last_verified_at: ago(0.1), crawled_at: ago(10), verification_failures: 1 })).toBe(false);
  });
});
