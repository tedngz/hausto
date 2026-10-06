// The number's standing with Meta, and when it holds the digest.

import { describe, it, expect } from 'vitest';
import { marketingHold, numberStatusRow, parseNumberHealth } from './number-health.ts';

describe('reading Meta', () => {
  it('takes the rating and status from a phone-number response', () => {
    expect(parseNumberHealth({ id: '123', quality_rating: 'green', status: 'connected' }))
      .toEqual({ qualityRating: 'GREEN', status: 'CONNECTED' });
  });

  it('reads a missing or renamed field as unknown, never as a failure', () => {
    expect(parseNumberHealth({ id: '123' })).toEqual({ qualityRating: 'UNKNOWN', status: null });
    expect(parseNumberHealth(null)).toEqual({ qualityRating: 'UNKNOWN', status: null });
    expect(parseNumberHealth({ quality_rating: 3 })).toEqual({ qualityRating: 'UNKNOWN', status: null });
  });
});

describe('the hold on marketing', () => {
  it('lets the digest go while the number is green', () => {
    expect(marketingHold({ quality_rating: 'GREEN', status: 'CONNECTED' })).toBeNull();
  });

  it('holds it while Meta rates the number yellow or red', () => {
    expect(marketingHold({ quality_rating: 'YELLOW', status: 'CONNECTED' })).toBe('Meta rates the number YELLOW');
    expect(marketingHold({ quality_rating: 'red', status: null })).toBe('Meta rates the number RED');
  });

  it('holds it when Meta has flagged or restricted the number, whatever the rating says', () => {
    expect(marketingHold({ quality_rating: 'GREEN', status: 'FLAGGED' })).toBe('Meta has flagged the number');
    expect(marketingHold({ quality_rating: 'NA', status: 'RESTRICTED' })).toBe('Meta has restricted the number');
  });

  it('does not hold for a number Meta has not rated, or before the first reading', () => {
    // The hold protects the number from us; a missing reading is not evidence
    // of harm, and the digest sent before this check existed.
    expect(marketingHold({ quality_rating: 'NA', status: 'CONNECTED' })).toBeNull();
    expect(marketingHold({ quality_rating: 'UNKNOWN', status: null })).toBeNull();
    expect(marketingHold({ quality_rating: null, status: null })).toBeNull();
    expect(marketingHold(null)).toBeNull();
  });
});

describe('the stored row', () => {
  const now = new Date('2026-10-09T03:00:00Z');

  it('records when the rating changed and from what', () => {
    const row = numberStatusRow({ qualityRating: 'YELLOW', status: 'CONNECTED' }, 'GREEN', now);
    expect(row).toMatchObject({
      id: 'singleton', quality_rating: 'YELLOW', previous_rating: 'GREEN',
      rating_changed_at: now.toISOString(), checked_at: now.toISOString(), last_error: null,
    });
  });

  it('leaves the change columns alone when the rating has not moved', () => {
    const row = numberStatusRow({ qualityRating: 'GREEN', status: 'CONNECTED' }, 'GREEN', now);
    expect(row).not.toHaveProperty('previous_rating');
    expect(row).not.toHaveProperty('rating_changed_at');
    expect(row.checked_at).toBe(now.toISOString());
  });
});
