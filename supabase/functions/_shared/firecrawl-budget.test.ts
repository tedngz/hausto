import { describe, it, expect } from 'vitest';
import {
  FIRECRAWL_DAILY_CREDITS,
  FirecrawlBudgetError,
  firecrawlBudgetKey,
  firecrawlCreditsLeft,
  planRun,
  spendFirecrawlCredit,
  type Counter,
} from './firecrawl-budget.ts';

function fakeCounter(start: Record<string, number> = {}, broken = false) {
  const store = { ...start };
  const counter: Counter = {
    get: async (k) => { if (broken) throw new Error('down'); return store[k] ?? 0; },
    incr: async (k) => { if (broken) throw new Error('down'); store[k] = (store[k] ?? 0) + 1; return store[k]; },
    decr: async (k) => { store[k] = (store[k] ?? 0) - 1; return store[k]; },
    expire: async () => 1,
  };
  return { counter, store };
}

const NOW = new Date('2026-10-08T03:00:00Z');
const KEY = firecrawlBudgetKey(NOW);

describe('the daily ceiling', () => {
  it('lets exactly FIRECRAWL_DAILY_CREDITS calls through, then refuses', async () => {
    const { counter, store } = fakeCounter();
    for (let i = 1; i <= FIRECRAWL_DAILY_CREDITS; i++) {
      expect(await spendFirecrawlCredit(counter, NOW)).toBe(i);
    }
    await expect(spendFirecrawlCredit(counter, NOW)).rejects.toBeInstanceOf(FirecrawlBudgetError);
    await expect(spendFirecrawlCredit(counter, NOW)).rejects.toBeInstanceOf(FirecrawlBudgetError);
    // A refused call spends nothing: the count never passes the ceiling.
    expect(store[KEY]).toBe(FIRECRAWL_DAILY_CREDITS);
  });

  it('is 50', () => {
    expect(FIRECRAWL_DAILY_CREDITS).toBe(50);
  });

  it('starts again each UTC day', async () => {
    const { counter } = fakeCounter({ [KEY]: FIRECRAWL_DAILY_CREDITS });
    await expect(spendFirecrawlCredit(counter, NOW)).rejects.toBeInstanceOf(FirecrawlBudgetError);
    expect(await spendFirecrawlCredit(counter, new Date('2026-10-09T00:00:01Z'))).toBe(1);
  });

  it('fails closed when the counter cannot be read', async () => {
    const { counter } = fakeCounter({}, true);
    await expect(spendFirecrawlCredit(counter, NOW)).rejects.toBeInstanceOf(FirecrawlBudgetError);
    expect(await firecrawlCreditsLeft(counter, NOW)).toBe(0);
  });

  it('reports what is left', async () => {
    expect(await firecrawlCreditsLeft(fakeCounter({ [KEY]: 12 }).counter, NOW)).toBe(38);
    expect(await firecrawlCreditsLeft(fakeCounter({ [KEY]: 80 }).counter, NOW)).toBe(0);
  });
});

describe('planning a run against what is left', () => {
  it('pays a search page and a detail page per listing on batdongsan and housingsgn', () => {
    expect(planRun('batdongsan', 50, 3)).toEqual({ run: true, maxResults: 3 });
    expect(planRun('housingsgn', 3, 3)).toEqual({ run: true, maxResults: 2 });
    expect(planRun('batdongsan', 2, 3)).toEqual({ run: true, maxResults: 1 });
  });

  it('does not buy a search page it cannot follow up', () => {
    expect(planRun('batdongsan', 1, 3)).toEqual({ run: false, maxResults: 0 });
    expect(planRun('housingsgn', 0, 3)).toEqual({ run: false, maxResults: 0 });
  });

  it('needs only the search page on nhatot, whose listings come from the ad API', () => {
    expect(planRun('nhatot', 1, 3)).toEqual({ run: true, maxResults: 3 });
    expect(planRun('nhatot', 0, 3)).toEqual({ run: false, maxResults: 0 });
  });

  it('keeps the schedule inside the ceiling at 3 a run', () => {
    // 10 Ho Chi Minh City districts x 3 sources, each every 48 hours: 5 runs a
    // source a day. Worst case, every search page through Firecrawl and every
    // run finding 3 new listings.
    const runsPerSourcePerDay = (10 * 24 * 60) / 2880;
    const perRun = { batdongsan: 1 + 3, housingsgn: 1 + 3, nhatot: 1 };
    const worst = runsPerSourcePerDay * (perRun.batdongsan + perRun.housingsgn + perRun.nhatot);
    expect(worst).toBe(45);
    expect(worst).toBeLessThanOrEqual(FIRECRAWL_DAILY_CREDITS);
  });
});
