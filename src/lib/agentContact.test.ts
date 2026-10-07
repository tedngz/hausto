import { describe, expect, it } from 'vitest';
import { displayVnPhone, parseReveal, safeHttpUrl, zaloLink } from './agentContact';

describe('parseReveal', () => {
  it('reads a number and its ad', () => {
    expect(parseReveal({ ok: true, phone_e164: '+84901234567', source_url: 'https://batdongsan.com.vn/x' }))
      .toEqual({ ok: true, phoneE164: '+84901234567', sourceUrl: 'https://batdongsan.com.vn/x' });
  });

  it('keeps the number when the link is missing or not a web address', () => {
    expect(parseReveal({ ok: true, phone_e164: '+84901234567', source_url: null }))
      .toEqual({ ok: true, phoneE164: '+84901234567', sourceUrl: null });
    expect(parseReveal({ ok: true, phone_e164: '+84901234567', source_url: 'javascript:alert(1)' }))
      .toEqual({ ok: true, phoneE164: '+84901234567', sourceUrl: null });
  });

  it('passes each refusal through', () => {
    for (const reason of ['sign_in', 'unknown_listing', 'no_number', 'daily_limit'] as const) {
      expect(parseReveal({ ok: false, reason })).toEqual({ ok: false, reason });
    }
  });

  it('treats anything else as an error, never as a number', () => {
    expect(parseReveal(null)).toEqual({ ok: false, reason: 'error' });
    expect(parseReveal({ ok: false, reason: 'something new' })).toEqual({ ok: false, reason: 'error' });
    expect(parseReveal({ ok: true, phone_e164: '0901234567' })).toEqual({ ok: false, reason: 'error' });
    expect(parseReveal({ ok: true, phone_e164: '+44 20 7946 0000' })).toEqual({ ok: false, reason: 'error' });
  });
});

describe('displayVnPhone', () => {
  it('groups a mobile and a Ho Chi Minh City landline', () => {
    expect(displayVnPhone('+84901234567')).toBe('+84 90 123 4567');
    expect(displayVnPhone('+842812345678')).toBe('+84 28 1234 5678');
  });

  it('leaves a shape it does not know alone', () => {
    expect(displayVnPhone('+8412345')).toBe('+8412345');
  });
});

describe('zaloLink', () => {
  it('opens a mobile in its local form', () => {
    expect(zaloLink('+84901234567')).toBe('https://zalo.me/0901234567');
  });

  it('has nothing for a landline', () => {
    expect(zaloLink('+842812345678')).toBeNull();
  });
});

describe('safeHttpUrl', () => {
  it('allows web addresses only', () => {
    expect(safeHttpUrl('https://nhatot.com/a')).toBe('https://nhatot.com/a');
    expect(safeHttpUrl('data:text/html,hi')).toBeNull();
    expect(safeHttpUrl('not a url')).toBeNull();
    expect(safeHttpUrl(42)).toBeNull();
  });
});
