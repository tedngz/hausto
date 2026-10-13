import { describe, it, expect } from 'vitest';
import {
  dayStartUtc,
  FREE_NUMBER_DAILY_SEARCHES,
  GLOBAL_DAILY_SEARCH_CAP,
  NUMBER_DAILY_SEARCH_CAP,
  QUIET_MS,
  searchAllowance,
  settleBurst,
  type ThreadMessage,
} from './search-limits.ts';
import { FREE_DAILY_AI_CREDITS } from '../ai-credits.ts';

const base = { linked: false, hasPass: false, numberToday: 0, globalToday: 0, accountSpent: null };

describe('searchAllowance', () => {
  it('gives a number with no account a few searches a day', () => {
    expect(searchAllowance({ ...base, numberToday: FREE_NUMBER_DAILY_SEARCHES - 1 }).ok).toBe(true);
    expect(searchAllowance({ ...base, numberToday: FREE_NUMBER_DAILY_SEARCHES }))
      .toEqual({ ok: false, reason: 'NUMBER_LIMIT' });
  });

  it('spends a linked account from the web chat allowance', () => {
    const linked = { ...base, linked: true, numberToday: 5 };
    expect(searchAllowance({ ...linked, accountSpent: FREE_DAILY_AI_CREDITS }).ok).toBe(true);
    expect(searchAllowance({ ...linked, accountSpent: FREE_DAILY_AI_CREDITS + 1 }))
      .toEqual({ ok: false, reason: 'ACCOUNT_CREDITS' });
  });

  it('lets a search through when the credit counter could not be read', () => {
    expect(searchAllowance({ ...base, linked: true, numberToday: 8, accountSpent: null }).ok).toBe(true);
  });

  it('does not count credits against a Pass holder', () => {
    expect(searchAllowance({ ...base, linked: true, hasPass: true, numberToday: 20, accountSpent: 99 }).ok).toBe(true);
  });

  it('caps any one number, Pass or not', () => {
    expect(searchAllowance({ ...base, linked: true, hasPass: true, numberToday: NUMBER_DAILY_SEARCH_CAP }))
      .toEqual({ ok: false, reason: 'DAILY_LIMIT' });
  });

  it('caps every number together, before anything else', () => {
    expect(searchAllowance({ ...base, linked: true, hasPass: true, globalToday: GLOBAL_DAILY_SEARCH_CAP }))
      .toEqual({ ok: false, reason: 'GLOBAL_CAP' });
  });
});

describe('dayStartUtc', () => {
  it('is midnight UTC - 07:00 in Ho Chi Minh City, as chat-ai counts', () => {
    expect(dayStartUtc(new Date('2026-10-13T23:59:00+07:00'))).toBe('2026-10-13T00:00:00.000Z');
    expect(dayStartUtc(new Date('2026-10-14T06:59:00+07:00'))).toBe('2026-10-13T00:00:00.000Z');
    expect(dayStartUtc(new Date('2026-10-14T07:00:00+07:00'))).toBe('2026-10-14T00:00:00.000Z');
  });
});

describe('settleBurst', () => {
  const T = Date.parse('2026-10-13T10:00:00Z');
  const at = (s: number) => new Date(T + s * 1000).toISOString();
  const msg = (id: string, direction: string, body: string, s: number, key?: string): ThreadMessage =>
    ({ id, direction, body, created_at: at(s), idempotency_key: key ?? null });

  const burst = [
    msg('a', 'IN', 'hi', 0),
    msg('b', 'IN', 'looking for 2br', 2),
    msg('c', 'IN', 'thao dien', 4),
    msg('d', 'IN', 'under 20tr', 6),
  ];

  it('waits while the renter is still typing', () => {
    expect(settleBurst(burst, 'b', new Date(T + 6000 + QUIET_MS - 1))).toEqual({ kind: 'WAIT' });
  });

  it('gathers the whole burst once they stop, and answers its newest message', () => {
    expect(settleBurst(burst, 'b', new Date(T + 6000 + QUIET_MS))).toEqual({
      kind: 'READY', answersMessageId: 'd', query: 'hi\nlooking for 2br\nthao dien\nunder 20tr',
    });
  });

  it('searches what it has when told to stop waiting', () => {
    expect(settleBurst(burst, 'b', new Date(T + 7000), true).kind).toBe('READY');
  });

  it('starts the burst after the last thing we sent', () => {
    const thread = [
      msg('x', 'IN', 'studio d1', 0),
      msg('y', 'OUT', 'results', 10),
      msg('z', 'IN', 'what about d2', 20),
    ];
    expect(settleBurst(thread, 'z', new Date(T + 60_000)))
      .toEqual({ kind: 'READY', answersMessageId: 'z', query: 'what about d2' });
  });

  it('runs across the greeting, which answers nothing', () => {
    const thread = [msg('a', 'IN', 'hi', 0), msg('w', 'OUT', 'welcome', 1, 'r1:WELCOME:1'), msg('b', 'IN', '2br d2', 1)];
    const s = settleBurst(thread, 'b', new Date(T + 30_000));
    expect(s).toEqual({ kind: 'READY', answersMessageId: 'b', query: 'hi\n2br d2' });
  });

  it('stands down when something of ours has answered the message since', () => {
    const thread = [...burst, msg('o', 'OUT', 'results', 7)];
    expect(settleBurst(thread, 'b', new Date(T + 60_000))).toEqual({ kind: 'GONE' });
  });

  it('keeps the newest words when the burst is long', () => {
    const long = [msg('p', 'IN', 'x'.repeat(700), 0), msg('q', 'IN', 'under 20tr', 1)];
    const s = settleBurst(long, 'q', new Date(T + 60_000));
    expect(s.kind === 'READY' && s.query.endsWith('under 20tr')).toBe(true);
    expect(s.kind === 'READY' && s.query.length).toBe(600);
  });
});
