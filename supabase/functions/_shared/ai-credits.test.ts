import { describe, it, expect, vi } from 'vitest';
import { aiCreditKey, creditAllows, CREDITS_USED_REPLY, FREE_DAILY_AI_CREDITS } from './ai-credits.ts';

describe('the daily counter', () => {
  it('is per renter and per UTC day', () => {
    const late = new Date('2026-10-08T23:59:00.000Z');
    const next = new Date('2026-10-09T00:00:00.000Z');
    expect(aiCreditKey('u1', late)).toBe('chat-ai:credits:u1:2026-10-08');
    expect(aiCreditKey('u1', next)).toBe('chat-ai:credits:u1:2026-10-09');
    expect(aiCreditKey('u2', late)).not.toBe(aiCreditKey('u1', late));
  });

  it('starts again at 07:00 in Ho Chi Minh City', () => {
    // 06:59 and 07:00 ICT are 23:59 and 00:00 UTC.
    expect(aiCreditKey('u1', new Date('2026-10-09T06:59:00+07:00')))
      .not.toBe(aiCreditKey('u1', new Date('2026-10-09T07:00:00+07:00')));
  });
});

describe('a message goes ahead', () => {
  it('within the allowance, without asking about the Pass', async () => {
    const covered = vi.fn(async () => false);
    for (let spent = 1; spent <= FREE_DAILY_AI_CREDITS; spent++) {
      expect(await creditAllows(spent, covered)).toBe(true);
    }
    expect(covered).not.toHaveBeenCalled();
  });

  it('past the allowance only with the Pass', async () => {
    expect(await creditAllows(FREE_DAILY_AI_CREDITS + 1, async () => true)).toBe(true);
    expect(await creditAllows(FREE_DAILY_AI_CREDITS + 1, async () => false)).toBe(false);
    expect(await creditAllows(500, async () => false)).toBe(false);
  });
});

describe('the reply when they are gone', () => {
  it('names the allowance and both ways on, and says nothing about booking', () => {
    expect(CREDITS_USED_REPLY).toContain(String(FREE_DAILY_AI_CREDITS));
    expect(CREDITS_USED_REPLY).toMatch(/tomorrow/);
    expect(CREDITS_USED_REPLY).toMatch(/Pass/);
    expect(CREDITS_USED_REPLY).not.toMatch(/book/i);
    expect(CREDITS_USED_REPLY).not.toMatch(/—/); // no em dash in anything a renter reads
  });
});
