import { describe, it, expect } from 'vitest';
import { renderIntakeAlert, sendIntakeAlert, missingContactsFor, CONSOLE_URL } from './ops-alert.ts';

describe('the new-request alert (gap 10)', () => {
  it('says when the renter expects to move in, when they said', () => {
    const base = {
      ref: 'HV-4KX9', placeCount: 1,
      availability: [{ date: '2026-10-15', part: 'MORNING' }],
      createdAt: new Date('2026-10-13T03:00:00Z'),
    };
    expect(renderIntakeAlert({ ...base, moveInDate: '2026-11-01' }).text).toContain('Expects to move in: 2026-11-01.');
    expect(renderIntakeAlert(base).text).not.toContain('move in');
  });

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

  it('flags places with no agent number, in the subject and first in the body, with their links', () => {
    const flagged = renderIntakeAlert({
      ref: 'HV-4KX9',
      placeCount: 3,
      availability: [{ date: '2026-09-29', part: 'MORNING' }],
      createdAt: new Date('2026-09-26T16:05:00Z'),
      missingContact: [
        { title: 'Grand Marina 2PN', url: 'https://batdongsan.com.vn/pr46365144', shows: '0933 886 ***' },
        { title: 'Studio Quận 4', url: null, shows: null },
      ],
    });
    expect(flagged.subject).toBe('New viewing request HV-4KX9 - 3 places - 2 with no agent number');
    expect(flagged.text).toContain('No agent number for these 2 places');
    expect(flagged.text).toContain('- Grand Marina 2PN (shows 0933 886 ***): https://batdongsan.com.vn/pr46365144');
    expect(flagged.text).toContain('- Studio Quận 4: no link on file');
    expect(flagged.text.indexOf('No agent number')).toBeLessThan(flagged.text.indexOf(CONSOLE_URL));
  });

  it('flags a place that joined an open request too', () => {
    const joined = renderIntakeAlert({
      ref: 'HV-4KX9', placeCount: 2, added: 1,
      availability: [], createdAt: new Date('2026-09-26T16:05:00Z'),
      missingContact: [{ title: 'Căn hộ Thảo Điền', url: 'https://www.nhatot.com/1.htm', shows: '098890****' }],
    });
    expect(joined.subject).toBe('HV-4KX9 - 1 more place added, 2 places now - 1 with no agent number');
    expect(joined.text).toContain('No agent number for this place');
  });

  it('says nothing about numbers when every place has one', () => {
    expect(alert.subject).not.toContain('agent number');
    expect(alert.text).not.toContain('No agent number');
  });

  it('looks up the unresolved listings, and still flags them when the lookup fails', async () => {
    const db = {
      from: () => ({
        select: () => ({
          in: () => Promise.resolve({ data: [{ id: 'l2', title: ' Studio Quận 4 ', source_url: 'https://x/l2', contact_phone: '0775 924 ***' }] }),
        }),
      }),
    };
    expect(await missingContactsFor(db, ['l2', 'l9'])).toEqual([
      { title: 'Studio Quận 4', url: 'https://x/l2', shows: '0775 924 ***' },
      { title: 'A listing', url: null, shows: null },
    ]);
    expect(await missingContactsFor(db, [])).toEqual([]);
    const broken = { from: () => { throw new Error('db down'); } };
    expect(await missingContactsFor(broken, ['l2'])).toEqual([{ title: 'A listing', url: null, shows: null }]);
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
