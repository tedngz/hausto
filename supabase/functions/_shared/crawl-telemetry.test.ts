import { describe, it, expect } from 'vitest';
import {
  assessRun,
  assessVerification,
  dominant,
  DOMINANT_REJECTION_SHARE,
  DEACTIVATION_REASON_SHARE,
  MIN_SAMPLE,
  type RunCounts,
} from './crawl-telemetry.ts';

const run = (over: Partial<RunCounts> = {}): RunCounts => ({
  attempted: 20, written: 12, updated: 3, duplicates: 2, rejected: 3, reasons: { too_few_images: 3 }, ...over,
});

describe('the run that started all this', () => {
  it('calls the nhatot failure unhealthy', () => {
    // 894 candidates, every one rejected as too_few_images:1, 35 days running,
    // every run reporting success. This is that run.
    const a = assessRun({
      attempted: 894, written: 0, updated: 0, duplicates: 0, rejected: 894,
      reasons: { 'too_few_images:1': 894 },
    });
    expect(a.healthy).toBe(false);
    expect(a.verdict).toBe('ALL_REJECTED');
    expect(a.message).toContain('894');
    expect(a.message).toContain('not quiet');
    expect(a.dominantReason).toBe('too_few_images:1');
  });

  it('catches the same fault while it is still partial', () => {
    // 85% is the same bug a week earlier, which is the point of a threshold
    // below 100%.
    const a = assessRun({
      attempted: 100, written: 15, updated: 0, duplicates: 0, rejected: 85,
      reasons: { 'too_few_images:1': 85 },
    });
    expect(a.healthy).toBe(false);
    expect(a.verdict).toBe('DOMINANT_REJECTION');
    expect(a.dominantShare).toBeCloseTo(0.85);
  });

  it('leaves an ordinary run alone', () => {
    const a = assessRun(run());
    expect(a.healthy).toBe(true);
    expect(a.verdict).toBe('OK');
  });

  it('does not flag a spread of ordinary misses', () => {
    // Half rejected, but for four different reasons - that is a crawl doing
    // its job, not a source that broke.
    const a = assessRun({
      attempted: 40, written: 20, updated: 0, duplicates: 0, rejected: 20,
      reasons: { too_few_images: 6, price_below_floor: 5, no_price: 5, duplicate_title: 4 },
    });
    expect(a.healthy).toBe(true);
  });
});

describe('what is not a fault', () => {
  it('treats an empty search page as a quiet day, not a break', () => {
    // Flagging this would train everyone to ignore the flag.
    const a = assessRun({ attempted: 0, written: 0, updated: 0, duplicates: 0, rejected: 0, reasons: {} });
    expect(a.healthy).toBe(true);
    expect(a.verdict).toBe('NOTHING_ATTEMPTED');
  });

  it('does not judge a handful of candidates', () => {
    // Three of three rejected is a share of 1.0 and means nothing.
    const a = assessRun({ attempted: 3, written: 0, updated: 0, duplicates: 0, rejected: 3, reasons: { x: 3 } });
    expect(a.healthy).toBe(true);
    expect(MIN_SAMPLE).toBeGreaterThan(3);
  });

  it('counts an all-duplicates run as healthy', () => {
    // Re-crawling a location we already hold writes nothing and is correct.
    const a = assessRun({ attempted: 30, written: 0, updated: 0, duplicates: 30, rejected: 0, reasons: {} });
    expect(a.healthy).toBe(true);
  });

  it('counts an all-updates run as healthy', () => {
    const a = assessRun({ attempted: 30, written: 0, updated: 30, duplicates: 0, rejected: 0, reasons: {} });
    expect(a.healthy).toBe(true);
  });
});

describe('candidates that vanish', () => {
  it('flags a run where nothing was written, updated, duplicated or rejected', () => {
    // Worse than a rejection: there is no reason recorded to look up.
    const a = assessRun({ attempted: 25, written: 0, updated: 0, duplicates: 0, rejected: 0, reasons: {} });
    expect(a.healthy).toBe(false);
    expect(a.verdict).toBe('NOTHING_WRITTEN');
    expect(a.message).toContain('unaccounted');
  });
});

describe('the dominant reason', () => {
  it('picks the biggest', () => {
    expect(dominant({ a: 1, b: 9, c: 3 })).toEqual({ reason: 'b', count: 9 });
  });

  it('is null when there are none', () => {
    expect(dominant({})).toBeNull();
  });

  it('uses a threshold below total failure on purpose', () => {
    expect(DOMINANT_REJECTION_SHARE).toBeLessThan(1);
    expect(DOMINANT_REJECTION_SHARE).toBeGreaterThan(0.5);
  });
});

describe('verification passes', () => {
  it('holds the 20% ceiling PLAN-v3 asks for', () => {
    expect(DEACTIVATION_REASON_SHARE).toBe(0.2);
    const a = assessVerification({ checked: 100, reasons: { gateway_not_found: 21 } });
    expect(a.healthy).toBe(false);
    expect(a.reason).toBe('gateway_not_found');
    expect(a.message).toContain('21 of 100');
  });

  it('allows a pass just under it', () => {
    expect(assessVerification({ checked: 100, reasons: { gateway_not_found: 20 } }).healthy).toBe(true);
  });

  it('is stricter than the crawl threshold, because deactivation removes supply', () => {
    // A rejection declines to add a listing; a deactivation takes one away.
    expect(DEACTIVATION_REASON_SHARE).toBeLessThan(DOMINANT_REJECTION_SHARE);
  });

  it('says nothing about a pass that deactivated nothing', () => {
    const a = assessVerification({ checked: 200, reasons: {} });
    expect(a.healthy).toBe(true);
  });

  it('does not judge a tiny pass', () => {
    expect(assessVerification({ checked: 2, reasons: { gateway_not_found: 2 } }).healthy).toBe(true);
  });

  it('names the reason so the log line is actionable on its own', () => {
    const a = assessVerification({ checked: 50, reasons: { timeout: 40 } });
    expect(a.message).toContain('timeout');
    expect(a.message).toContain('80%');
  });
});
