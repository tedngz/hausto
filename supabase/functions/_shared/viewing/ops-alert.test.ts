import { describe, it, expect } from 'vitest';
import { renderIntakeAlert, sendIntakeAlert, CONSOLE_URL } from './ops-alert.ts';

describe('the new-request alert (gap 10)', () => {
  const alert = renderIntakeAlert({
    ref: 'HV-4KX9',
    placeCount: 3,
    availability: [{ date: '2026-09-29', part: 'MORNING' }, { date: '2026-10-01', part: 'EVENING' }],
    createdAt: new Date('2026-09-26T16:05:00Z'), // 23:05 in Ho Chi Minh City
  });

  it('says which request, how big, and when - in local time', () => {
    expect(alert.subject).toBe('New viewing request HV-4KX9 - 3 places');
    expect(alert.text).toContain('HV-4KX9 came in at 23:05 on 2026-09-26 (Ho Chi Minh City) for 3 places.');
    expect(alert.text).toContain('2026-09-29 morning, 2026-10-01 evening');
    expect(alert.text).toContain(CONSOLE_URL);
  });

  it('says so when places join a request that was already open', () => {
    const joined = renderIntakeAlert({
      ref: 'HV-4KX9',
      placeCount: 3,
      added: 1,
      availability: [{ date: '2026-09-29', part: 'MORNING' }],
      createdAt: new Date('2026-09-26T16:05:00Z'),
    });
    expect(joined.subject).toBe('HV-4KX9 - 1 more place added, 3 places now');
    expect(joined.text).toContain('Same times as before: 2026-09-29 morning.');
    expect(joined.text).toContain('The itinerary waits until they answer.');
    expect(joined.text).not.toMatch(/\+84|@/);
  });

  it('carries nothing about the renter, because it is given nothing', () => {
    expect(alert.text).not.toMatch(/\+84|@/);
  });

  it('skips quietly without a mail key rather than failing the request', async () => {
    const r = await sendIntakeAlert({}, alert, undefined);
    expect(r).toEqual({ sent: 0, skipped: 'RESEND_API_KEY not set' });
  });

  it('swallows a lookup failure rather than throwing into intake', async () => {
    const broken = { from: () => { throw new Error('db down'); } };
    const r = await sendIntakeAlert(broken, alert, 'key');
    expect(r.sent).toBe(0);
  });
});
