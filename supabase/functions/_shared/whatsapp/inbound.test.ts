import { describe, it, expect } from 'vitest';
import {
  verifyMetaSignature,
  parseInboundMessages,
  verifySubscription,
  toE164,
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
