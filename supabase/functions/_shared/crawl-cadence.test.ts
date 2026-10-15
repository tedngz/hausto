import { describe, it, expect } from 'vitest';
import { cronEveryMinutes } from './crawl-cadence.ts';

describe('cronEveryMinutes', () => {
  it('reads the shapes the crawl schedules use', () => {
    expect(cronEveryMinutes('*/30 * * * *')).toBe(30);
    expect(cronEveryMinutes('0,30 * * * *')).toBe(30);
    expect(cronEveryMinutes('7,37 * * * *')).toBe(30);
    expect(cronEveryMinutes('25 * * * *')).toBe(60);
    expect(cronEveryMinutes('* * * * *')).toBe(1);
    expect(cronEveryMinutes('0 */2 * * *')).toBe(120);
  });

  it('ignores the timezone prefix QStash allows', () => {
    expect(cronEveryMinutes('CRON_TZ=Asia/Ho_Chi_Minh */30 * * * *')).toBe(30);
  });

  it('refuses to put a rate on a schedule that fires unevenly', () => {
    expect(cronEveryMinutes('0,10 * * * *')).toBeNull();
    expect(cronEveryMinutes('*/7 * * * *')).toBeNull();
    expect(cronEveryMinutes('0 9 * * 1-5')).toBeNull();
    expect(cronEveryMinutes('30 19 * * *')).toBeNull();
    expect(cronEveryMinutes('not a cron')).toBeNull();
  });
});
