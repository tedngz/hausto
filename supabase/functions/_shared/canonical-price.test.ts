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
import { describedPrice } from './price-mentions.ts';

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
      .replace(/(\w+)\s+NOT\s+BETWEEN\s+(\S+)\s+AND\s+(\S+)/gi, '!($1 >= $2 && $1 <= $3)')
      .replace(/(\w+)\s+BETWEEN\s+(\S+)\s+AND\s+(\S+)/gi, '($1 >= $2 && $1 <= $3)')
      .replace(/(\w+)\s+IS\s+NOT\s+NULL\b/gi, '($1 != null)')
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
const priceConfidenceFor = compile('price_confidence_for') as
  (vnd: number | null, describedMin: number | null, describedMax: number | null) => string | null;

/** What the trigger writes for a row whose text quotes no rent. */
const canonical = (source: string, price: number | null, display: string | null) => {
  const vnd = canonicalPriceVnd(source, price, display);
  return { vnd, confidence: priceConfidenceFor(vnd, null, null) };
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

// The other half of `price_confidence`: the price against the rent the
// listing's own title and description quote (price-crosscheck stores the
// range; this is the rule the trigger applies to it).
describe('the price against what the listing says', () => {
  const confidence = (vnd: number, text: [string, string]) => {
    const d = describedPrice(...text);
    return priceConfidenceFor(vnd, d?.min_vnd ?? null, d?.max_vnd ?? null);
  };

  it('flags the duplex extraction read off a similar-listings panel', () => {
    // Stored at 70M; the advert says 60 triệu.
    expect(confidence(70_000_000, ['Cho thuê duplex 3PN view nội khu giá 60 triệu', ''])).toBe('LOW');
  });

  it('flags a price far below what the text says', () => {
    expect(confidence(7_000_000, ['Bright 2BR in Thao Dien', 'Rent is 16 million VND per month.'])).toBe('LOW');
  });

  it('allows 15% either way', () => {
    const text: [string, string] = ['2BR - 16M VND/month', ''];
    expect(confidence(18_400_000, text)).toBe('HIGH'); // +15%
    expect(confidence(13_600_000, text)).toBe('HIGH'); // -15%
    expect(confidence(18_400_001, text)).toBe('LOW');
    expect(confidence(13_599_999, text)).toBe('LOW');
  });

  it('agrees with a housingsgn dollar price, whichever way it was stored', () => {
    // Stored raw in USD and converted by canonical_price_vnd...
    const raw = canonicalPriceVnd('housingsgn', 730, '$730 / month');
    expect(confidence(raw!, ['Rent: $730 / month', ''])).toBe('HIGH');
    // ...or already converted, with the dollar display never updated.
    expect(confidence(12_500_000, ['Studio near the river', 'Rent $500 per month.'])).toBe('HIGH');
  });

  it('accepts any price inside a range the advert quotes', () => {
    expect(confidence(10_000_000, ['1PN 8tr, 2PN 12tr', ''])).toBe('HIGH');
    expect(confidence(12_000_000, ['Giá 12 - 15 triệu tùy căn', ''])).toBe('HIGH');
  });

  it('does not read a deposit, a fee or a starting price as the rent', () => {
    expect(confidence(16_000_000, ['Giá 16tr - Cọc 32tr', 'Phí quản lý 1 triệu.'])).toBe('HIGH');
    expect(confidence(15_000_000, ['Căn hộ chỉ từ 6,5 triệu', ''])).toBe('HIGH');
  });

  it('leaves a listing whose text quotes nothing as the band alone judges it', () => {
    expect(confidence(16_000_000, ['Spacious 82m2 apartment', 'Great view, 3 bedrooms.'])).toBe('HIGH');
    expect(confidence(730, ['Spacious 82m2 apartment', ''])).toBe('LOW');
  });

  it('has no confidence without a price', () => {
    expect(priceConfidenceFor(null, 16_000_000, 16_000_000)).toBe(null);
  });
});
