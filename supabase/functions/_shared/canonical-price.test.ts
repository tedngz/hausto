// The `$730` row, caught in CI rather than by someone reading a table
// (PLAN-v3 S3).
//
// The rule lives in SQL - `canonical_price_vnd` and `price_confidence_for`,
// run by a trigger on every write to external_properties - and CI has no
// database. So this reads the newest definition of each function out of
// supabase/migrations and evaluates it. A copy of the rule in TypeScript would
// pass while the SQL drifted; this fails when the SQL does.
//
// The translator knows only the handful of constructs the two functions use.
// Rewriting one in anything else fails here with the construct named, which is
// the prompt to extend the translator, not to delete the test.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

const MIGRATIONS = new URL('../../migrations/', import.meta.url);

/** The body and argument names of the last migration to define `name`. */
function latestDefinition(name: string): { args: string[]; body: string; file: string } {
  const head = new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${name}\\(([^)]*)\\)[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`,
  );
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files.reverse()) {
    const m = readFileSync(new URL(file, MIGRATIONS), 'utf8').match(head);
    if (m) {
      const args = m[1].split(',').map((a) => a.trim().split(/\s+/)[0]).filter(Boolean);
      return { args, body: m[2], file };
    }
  }
  throw new Error(`no migration defines public.${name}`);
}

/** `SELECT CASE WHEN .. THEN .. [WHEN ..] ELSE .. END;` as a JS function. */
function compile(name: string): (...args: unknown[]) => unknown {
  const { args, body, file } = latestDefinition(name);
  const m = body.trim().match(/^SELECT\s+CASE\s+([\s\S]*?)\s+ELSE\s+([\s\S]*?)\s+END\s*;?$/i);
  if (!m) throw new Error(`${file}: ${name} is not a single SELECT CASE`);

  const expr = (sql: string): string => {
    const js = sql
      .replace(/(\w+)\s+BETWEEN\s+(\S+)\s+AND\s+(\S+)/gi, '($1 >= $2 && $1 <= $3)')
      .replace(/(\w+)\s+IS\s+NULL\b/gi, '($1 == null)')
      .replace(/\bOR\b/g, '||')
      .replace(/\bAND\b/g, '&&')
      .replace(/\bleast\(/gi, 'Math.min(')
      .replace(/\bround\(/gi, 'Math.round(')
      .replace(/::integer\b/gi, '')
      .replace(/\bNULL\b/g, 'null')
      .replace(/(?<![<>=!])=(?!=)/g, '===');
    const leftover = js
      .replace(/'[^']*'/g, '')
      .replace(/\bMath\.(min|round)\b/g, '')
      .replace(/\bnull\b/g, '')
      .replace(new RegExp(`\\b(${args.join('|')})\\b`, 'g'), '')
      .replace(/[\d\s.()<>=!&|*,+-]/g, '');
    if (leftover) throw new Error(`${file}: ${name} uses SQL this test cannot read: ${leftover}`);
    return js;
  };

  const branches = [...m[1].matchAll(/WHEN\s+([\s\S]*?)\s+THEN\s+([\s\S]*?)(?=\s+WHEN\s|$)/gi)];
  if (branches.length === 0) throw new Error(`${file}: ${name} has no WHEN branches`);
  const js = branches.reduceRight(
    (otherwise, [, when, then]) => `(${expr(when)}) ? (${expr(then)}) : (${otherwise})`,
    `(${expr(m[2])})`,
  );
  return new Function(...args, `return ${js};`) as (...a: unknown[]) => unknown;
}

const canonicalPriceVnd = compile('canonical_price_vnd') as
  (source: string, price: number | null, display: string | null) => number | null;
const priceConfidenceFor = compile('price_confidence_for') as (vnd: number | null) => string | null;

const canonical = (source: string, price: number | null, display: string | null) => {
  const vnd = canonicalPriceVnd(source, price, display);
  return { vnd, confidence: priceConfidenceFor(vnd) };
};

describe('the $730 row', () => {
  it('is dollars, and comes out as a rent in dong', () => {
    // housingsgn quotes USD. The live row: price = 730, '$730 / month'.
    expect(canonical('housingsgn', 730, '$730 / month')).toEqual({ vnd: 18_250_000, confidence: 'HIGH' });
  });
});

describe('the two rules that were tried first, and were wrong', () => {
  it('does not trust a $ in the display', () => {
    // Already converted; the display was never updated. Multiplying it gave
    // 312,500,000,000 dong.
    expect(canonical('housingsgn', 12_500_000, '$500/month')).toEqual({ vnd: 12_500_000, confidence: 'HIGH' });
  });

  it('keeps a cheap rent in dong as dong', () => {
    // "Under 3,000,000 is USD" turned this into 70 billion.
    expect(canonical('nhatot', 2_800_000, '2,8 triệu/tháng')).toEqual({ vnd: 2_800_000, confidence: 'HIGH' });
  });
});

describe('the class', () => {
  it('turns every plausible dollar rent into a plausible dong rent', () => {
    for (let usd = 100; usd <= 7_500; usd += 1) {
      const { vnd, confidence } = canonical('housingsgn', usd, `$${usd} / month`);
      expect(vnd, `$${usd}`).toBeGreaterThan(usd);
      expect(confidence, `$${usd} -> ${vnd}`).toBe('HIGH');
    }
  });

  it('leaves every plausible dong rent alone', () => {
    // The crawler's own accepted band (scheduled-crawl MIN/MAX_PRICE_VND).
    for (let vnd = 5_000_000; vnd <= 200_000_000; vnd += 250_000) {
      for (const source of ['batdongsan', 'nhatot', 'housingsgn']) {
        expect(canonical(source, vnd, null), `${source} ${vnd}`).toEqual({ vnd, confidence: 'HIGH' });
      }
    }
  });

  it('has no price at all rather than a made-up one', () => {
    for (const price of [null, 0, -730]) {
      expect(canonical('housingsgn', price, null)).toEqual({ vnd: null, confidence: null });
    }
  });

  it('marks what cannot be a monthly rent as not shortlistable', () => {
    // 100,000 dong is not a rent in either currency.
    expect(canonical('nhatot', 100_000, null).confidence).toBe('LOW');
    // A sale price in a rental listing.
    expect(canonical('batdongsan', 4_500_000_000, null).confidence).toBe('LOW');
  });

  it('stays inside a Postgres integer', () => {
    const { vnd } = canonical('batdongsan', 99_999_999_999, null);
    expect(vnd).toBe(2_147_483_647);
  });
});
