import { describe, expect, it } from 'vitest';
import { imageHighlightsOf, orderResults } from './order.ts';

const ext = (id: string, group: string | null = null, conflict = false) => ({
  id,
  canonical_group_id: group,
  image_location_conflict: conflict,
});

describe('orderResults', () => {
  it('puts internal listings first, in the order given', () => {
    const out = orderResults([{ id: 'i1' }, { id: 'i2' }], [ext('e1')]);
    expect(out.map((e) => e.id)).toEqual(['i1', 'i2', 'e1']);
    expect(out[0]).toEqual({ table: 'internal', id: 'i1' });
  });

  it('collapses a duplicate group to its first (newest) member, counting postings', () => {
    const out = orderResults([], [ext('a', 'g'), ext('b'), ext('c', 'g'), ext('d', 'g')]);
    expect(out).toEqual([
      { table: 'external', id: 'a', posting_count: 3 },
      { table: 'external', id: 'b', posting_count: 1 },
    ]);
  });

  it('sinks suspected bait to the end, after internal and clean rows', () => {
    const out = orderResults([{ id: 'i' }], [ext('bait', null, true), ext('ok'), ext('bait2', 'g', true), ext('dup', 'g')]);
    expect(out.map((e) => e.id)).toEqual(['i', 'ok', 'bait', 'bait2']);
    expect(out[3]).toEqual({ table: 'external', id: 'bait2', posting_count: 2 });
  });

  it('is empty when nothing matches - total 0, not an error', () => {
    expect(orderResults([], [])).toEqual([]);
  });
});

describe('imageHighlightsOf', () => {
  it('prefers the computed field', () => {
    expect(imageHighlightsOf({ image_highlights: ['a', 'b'], image_analyses: [{ image_highlight: 'x' }] })).toEqual(['a', 'b']);
  });

  it('falls back to the analyses with the old rule', () => {
    expect(
      imageHighlightsOf({ image_analyses: [{ image_highlight: 'a' }, { image_highlight: '', highlight: 'b' }, null, 'junk', {}] }),
    ).toEqual(['a', 'b', '', '', '']);
  });

  it('gives an empty list for anything else', () => {
    expect(imageHighlightsOf({})).toEqual([]);
    expect(imageHighlightsOf({ image_analyses: { not: 'an array' } })).toEqual([]);
  });
});
