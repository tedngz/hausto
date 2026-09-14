import { describe, it, expect } from 'vitest';
import {
  parseSelection,
  looksLikeSelection,
  resolveSelection,
  renderSelectionProblem,
  renderReRequested,
  OFFER_TTL_HOURS,
  MAX_SELECTED,
  type Offer,
} from './selection.ts';

const NOW = new Date('2026-09-14T03:00:00Z');
const offer = (hoursAgo = 1, ids = ['l1', 'l2', 'l3']): Offer => ({
  listingIds: ids,
  offeredAt: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString(),
});

describe('reading the reply', () => {
  it('reads a bare digit', () => {
    expect(parseSelection('2')).toEqual([2]);
    expect(parseSelection(' 1 ')).toEqual([1]);
  });

  it('reads several, in the order named', () => {
    expect(parseSelection('1 and 3')).toEqual([1, 3]);
    expect(parseSelection('3, 1')).toEqual([3, 1]);
    expect(parseSelection('2 3')).toEqual([2, 3]);
  });

  it('dedupes a double tap', () => {
    expect(parseSelection('1 1 2')).toEqual([1, 2]);
  });

  it('reads words, in both languages', () => {
    expect(parseSelection('the second one')).toEqual([2]);
    expect(parseSelection('cái thứ ba')).toEqual([3]);
    expect(parseSelection('first please')).toEqual([1]);
  });

  it('does not find "one" inside another word', () => {
    expect(parseSelection('phone')).toEqual([]);
  });

  it('reads "the second one" as the second, not the second and the first', () => {
    // "one" there is a noun. Matching ordinals and cardinals in one pass turns
    // a pick of the second listing into a pick of two.
    expect(parseSelection('the second one')).toEqual([2]);
    expect(parseSelection('the third one please')).toEqual([3]);
    // ...while a bare cardinal still works, since no ordinal matched.
    expect(parseSelection('one please')).toEqual([1]);
  });

  it('keeps word picks in the order they were said', () => {
    expect(parseSelection('third and first')).toEqual([3, 1]);
  });
});

describe('what is deliberately not a selection', () => {
  it('ignores prose that happens to contain a number', () => {
    // "I viewed 3 places last week and none worked" must not order viewing 3.
    expect(parseSelection('I viewed 3 places last week and none of them worked')).toEqual([]);
  });

  it('refuses the whole reply when any number is out of range', () => {
    // "1 and 4" against three offers means the renter miscounted. Acting on
    // the 1 and dropping the 4 orders a viewing they did not confirm.
    expect(parseSelection('1 and 4', 3)).toEqual([]);
    expect(parseSelection('7', 3)).toEqual([]);
  });

  it('is conservative about messages carrying more than a pick', () => {
    // A false positive books viewings nobody asked for; a false negative goes
    // to an operator who reads one line. Those costs are not close.
    expect(looksLikeSelection('2')).toBe(true);
    expect(looksLikeSelection('2 please')).toBe(true);
    expect(looksLikeSelection('number 2 thanks')).toBe(true);
    expect(looksLikeSelection('can I see 2 on saturday instead')).toBe(false);
    expect(looksLikeSelection('is 2 still available and what floor')).toBe(false);
  });

  it('is not a selection when there is no number at all', () => {
    expect(looksLikeSelection('yes')).toBe(false);
    expect(looksLikeSelection('')).toBe(false);
  });
});

describe('resolving against what was offered', () => {
  it('maps positions to listing ids', () => {
    const r = resolveSelection([1, 3], offer(), NOW);
    expect(r).toEqual({ ok: true, listingIds: ['l1', 'l3'] });
  });

  it('says so when nothing was offered', () => {
    expect(resolveSelection([1], null, NOW)).toEqual({ ok: false, reason: 'NO_OFFER' });
    expect(resolveSelection([1], { listingIds: [], offeredAt: NOW.toISOString() }, NOW))
      .toEqual({ ok: false, reason: 'NO_OFFER' });
  });

  it('expires a stale offer rather than booking something long gone', () => {
    // A renter replying "2" to last month's list would otherwise get a viewing
    // arranged on a flat that sold - exactly the experience this product exists
    // to remove.
    expect(resolveSelection([1], offer(OFFER_TTL_HOURS + 1), NOW)).toEqual({ ok: false, reason: 'EXPIRED' });
    expect(resolveSelection([1], offer(OFFER_TTL_HOURS - 1), NOW).ok).toBe(true);
  });

  it('rejects the whole reply on one bad position', () => {
    const r = resolveSelection([1, 9], offer(), NOW);
    expect(r).toEqual({ ok: false, reason: 'OUT_OF_RANGE' });
  });

  it('never returns more than a shortlist', () => {
    expect(MAX_SELECTED).toBe(5);
  });
});

describe('what the renter hears', () => {
  it('offers a way forward on every failure, never a dead end', () => {
    for (const reason of ['NO_OFFER', 'EXPIRED', 'OUT_OF_RANGE'] as const) {
      const text = renderSelectionProblem(reason);
      expect(text.length, reason).toBeGreaterThan(0);
      expect(text.toLowerCase(), reason).not.toContain('error');
    }
    expect(renderSelectionProblem('EXPIRED')).toContain('fresh ones');
  });

  it('confirms one place by name', () => {
    const text = renderReRequested({ ref: 'HV-4KX7', titles: ['Sunny 2BR in Thao Dien'] });
    expect(text).toContain('Sunny 2BR in Thao Dien');
    expect(text).toContain('HV-4KX7');
  });

  it('lists several, and promises the same turnaround as any request', () => {
    const text = renderReRequested({ ref: 'HV-4KX7', titles: ['A', 'B'] });
    expect(text).toContain('2 places');
    expect(text).toContain('within a day');
  });

  it('says request, never booking - nothing is agreed yet', () => {
    const text = renderReRequested({ ref: 'HV-4KX7', titles: ['A'] }).toLowerCase();
    for (const word of ['booked', 'booking', 'reserved', 'confirmed']) {
      expect(text, word).not.toContain(word);
    }
  });
});
