import { describe, it, expect } from 'vitest';
import {
  verifyMetaSignature,
  parseInboundMessages,
  verifySubscription,
  toE164,
  toRenterE164,
  waIdToE164,
  nationalNumber,
  isOptOut,
} from './inbound.ts';

const SECRET = 'app-secret';

async function sign(body: string, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return 'sha256=' + [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

describe('signature verification', () => {
  it('accepts a correctly signed body', async () => {
    const body = '{"entry":[]}';
    expect(await verifyMetaSignature(body, await sign(body), SECRET)).toBe(true);
  });

  it('rejects a body that changed by one character', async () => {
    const header = await sign('{"entry":[]}');
    expect(await verifyMetaSignature('{"entry":[1]}', header, SECRET)).toBe(false);
  });

  it('rejects the same body signed with a different secret', async () => {
    const body = '{"a":1}';
    expect(await verifyMetaSignature(body, await sign(body, 'wrong'), SECRET)).toBe(false);
  });

  it('rejects a missing or malformed header', async () => {
    expect(await verifyMetaSignature('{}', null, SECRET)).toBe(false);
    expect(await verifyMetaSignature('{}', 'deadbeef', SECRET)).toBe(false);
    expect(await verifyMetaSignature('{}', 'sha1=abc', SECRET)).toBe(false);
  });

  it('rejects everything when no app secret is configured', async () => {
    // Otherwise a missing secret silently means "accept anything".
    const body = '{"a":1}';
    expect(await verifyMetaSignature(body, await sign(body), '')).toBe(false);
  });

  it('is sensitive to whitespace, which is why the raw body must be used', async () => {
    const raw = '{"a":1}';
    const header = await sign(raw);
    const reserialised = JSON.stringify(JSON.parse(raw)) === raw ? '{ "a": 1 }' : JSON.stringify(JSON.parse(raw));
    expect(await verifyMetaSignature(reserialised, header, SECRET)).toBe(false);
  });
});

describe('payload parsing', () => {
  const payload = (messages: unknown[]) => ({
    entry: [{ changes: [{ value: { messages } }] }],
  });

  it('pulls out a text message', () => {
    const got = parseInboundMessages(payload([
      { from: '84901234567', id: 'wamid.1', text: { body: 'hello' }, timestamp: '1789000000' },
    ]));
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ from: '+84901234567', providerMessageId: 'wamid.1', text: 'hello' });
  });

  it('keeps a message from a renter on a foreign number', () => {
    // These were dropped: an expat on their home WhatsApp heard nothing back.
    const got = parseInboundMessages(payload([
      { from: '447700900123', id: 'wamid.uk', text: { body: 'hi' }, timestamp: '1789000000' },
    ]));
    expect(got[0]).toMatchObject({ from: '+447700900123', providerMessageId: 'wamid.uk' });
  });

  it('returns nothing for a status callback', () => {
    // Delivery receipts arrive on the same endpoint with no messages array.
    expect(parseInboundMessages({ entry: [{ changes: [{ value: { statuses: [{ status: 'read' }] } }] }] })).toEqual([]);
    expect(parseInboundMessages({})).toEqual([]);
    expect(parseInboundMessages(null)).toEqual([]);
  });

  it('handles several messages batched into one delivery', () => {
    const got = parseInboundMessages(payload([
      { from: '0901234567', id: 'a', text: { body: '1' } },
      { from: '0901234567', id: 'b', text: { body: '2' } },
    ]));
    expect(got.map(m => m.providerMessageId)).toEqual(['a', 'b']);
  });

  it('keeps a non-text message but with an empty body', () => {
    // An image still re-opens the service window, so dropping it would lose
    // that - but there is no text to act on.
    const got = parseInboundMessages(payload([{ from: '0901234567', id: 'img', image: { id: 'x' } }]));
    expect(got).toHaveLength(1);
    expect(got[0].text).toBe('');
  });

  it('skips a message with an unusable sender', () => {
    expect(parseInboundMessages(payload([{ from: 'not-a-number', id: 'z', text: { body: 'x' } }]))).toEqual([]);
  });
});

describe('phone normalisation', () => {
  it('accepts the forms Meta and the crawlers produce', () => {
    expect(toE164('+84901234567')).toBe('+84901234567');
    expect(toE164('84901234567')).toBe('+84901234567');
    expect(toE164('0901234567')).toBe('+84901234567');
    expect(toE164('+84 90 123 45 67')).toBe('+84901234567');
  });
  it('rejects anything else', () => {
    expect(toE164('0775 924 ***')).toBeNull();
    expect(toE164('12345')).toBeNull();
    expect(toE164('')).toBeNull();
  });
  it('stays Vietnamese-only, because agents are', () => {
    expect(toE164('+44 7700 900123')).toBeNull();
  });
});

describe('renter numbers, any country', () => {
  it('reads a Vietnamese number exactly as toE164 does', () => {
    for (const raw of ['0901234567', '+84 90 123 45 67', '84901234567']) {
      expect(toRenterE164(raw)).toBe('+84901234567');
    }
  });

  it('reads any other country written with its code', () => {
    expect(toRenterE164('+44 7700 900123')).toBe('+447700900123');
    expect(toRenterE164('+44 (0)7700 900123')).toBe('+447700900123');
    expect(toRenterE164('0044 7700 900123')).toBe('+447700900123');
    expect(toRenterE164('+1 (415) 555-0100')).toBe('+14155550100');
    expect(toRenterE164('+65 9123 4567')).toBe('+6591234567');
  });

  it('refuses a foreign number without its code, which could be any country', () => {
    expect(toRenterE164('7700 900123')).toBeNull();
    expect(toRenterE164('(415) 555-0100')).toBeNull();
  });

  it('refuses a mistyped Vietnamese number rather than reading it as foreign', () => {
    expect(toRenterE164('+84 90 123 45')).toBeNull();
    expect(toRenterE164('+84 90 123 45 678')).toBeNull();
  });

  it('refuses what is not a number', () => {
    expect(toRenterE164('+0 123 456 789')).toBeNull();
    expect(toRenterE164('+44 7700 9001 ext 2')).toBeNull();
    expect(toRenterE164('')).toBeNull();
  });

  it("reads Meta's sender id for any country, and a Vietnamese one as before", () => {
    expect(waIdToE164('84901234567')).toBe('+84901234567');
    expect(waIdToE164('447700900123')).toBe('+447700900123');
    expect(waIdToE164('14155550100')).toBe('+14155550100');
    expect(waIdToE164('')).toBeNull();
    expect(waIdToE164('123')).toBeNull();
  });

  it('keeps a typed number and the same person messaging us on one renter row', () => {
    expect(toRenterE164('+44 7700 900123')).toBe(waIdToE164('447700900123'));
    expect(toRenterE164('0901 234 567')).toBe(waIdToE164('84901234567'));
  });

  it('finds the national number behind any country code', () => {
    expect(nationalNumber('+84901234567')).toBe('901234567');
    expect(nationalNumber('+447700900123')).toBe('7700900123');
    expect(nationalNumber('+14155550100')).toBe('4155550100');
    expect(nationalNumber('+79161234567')).toBe('9161234567');
    expect(nationalNumber('+6591234567')).toBe('91234567');
    // Three-digit codes: Hong Kong, Ireland.
    expect(nationalNumber('+85291234567')).toBe('91234567');
    expect(nationalNumber('+353861234567')).toBe('861234567');
    expect(nationalNumber('not a number')).toBeNull();
  });
});

describe('subscription handshake', () => {
  it('echoes the challenge when the token matches', () => {
    const url = new URL('https://x/y?hub.mode=subscribe&hub.verify_token=tok&hub.challenge=12345');
    expect(verifySubscription(url, 'tok')).toEqual({ ok: true, challenge: '12345' });
  });
  it('refuses a wrong or absent token', () => {
    const url = new URL('https://x/y?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1');
    expect(verifySubscription(url, 'tok')).toEqual({ ok: false });
    expect(verifySubscription(url, '')).toEqual({ ok: false });
  });
});

describe('opt-out', () => {
  it('matches the whole message only', () => {
    expect(isOptOut('STOP')).toBe(true);
    expect(isOptOut(' hủy ')).toBe(true);
    // Substring matching would opt this renter out for agreeing with us.
    expect(isOptOut('dung được không')).toBe(false);
    expect(isOptOut('please stop by at 3pm')).toBe(false);
  });
});
