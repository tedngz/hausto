// Parsing and verifying what Meta sends us. Pure functions, so the webhook
// handler stays thin and these stay testable without a live callback.

/**
 * Meta signs the raw body with the app secret: `X-Hub-Signature-256:
 * sha256=<hex>`.
 *
 * Verified against the RAW body, never a re-serialised one - `JSON.parse` then
 * `JSON.stringify` reorders keys and changes whitespace, and the signature is
 * over bytes. That is the mistake that turns into an unexplained "bad
 * signature" nobody can reproduce.
 */
export async function verifyMetaSignature(
  rawBody: string,
  header: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!header || !appSecret) return false;
  const expectedPrefix = 'sha256=';
  if (!header.startsWith(expectedPrefix)) return false;
  const provided = header.slice(expectedPrefix.length).trim().toLowerCase();

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const computed = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');

  // Length-independent comparison. A timing side channel here is unlikely to be
  // practical, but constant-time comparison costs nothing.
  if (computed.length !== provided.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ provided.charCodeAt(i);
  return diff === 0;
}

export interface InboundMessage {
  from: string;
  providerMessageId: string;
  text: string;
  timestamp: string;
}

// ── Phone numbers ─────────────────────────────────────────────────────────
//
// Three functions, because there are three sources and they do not agree:
//
//   * `toE164` - a Vietnamese mobile in any shape the crawler or an operator
//     hands us. Agents are Vietnamese; this stays strict for them (the Zalo
//     bridge, a recorded agent contact, the crawler).
//   * `toRenterE164` - what a renter types. A Vietnamese number in its local
//     shapes, or any other country's written with its code. Renters are often
//     expats on their home number, and dropping them was dropping customers.
//   * `waIdToE164` - what Meta sends as `from`. Always full international
//     digits, so it is trusted as international.
//
// A Vietnamese renter comes out identical from all three, which is what keeps
// a typed number and an inbound message on one renter row.

/** A Vietnamese mobile number in E.164, or null. Agents, the crawler. */
export function toE164(raw: string): string | null {
  const d = String(raw ?? '').replace(/[^0-9+]/g, '');
  if (/^\+84[0-9]{9}$/.test(d)) return d;
  if (/^84[0-9]{9}$/.test(d)) return `+${d}`;
  if (/^0[0-9]{9}$/.test(d)) return `+84${d.slice(1)}`;
  return null;
}

/** E.164: a plus, a country code that does not start with 0, 7-15 digits in all. */
const E164 = /^\+[1-9][0-9]{6,14}$/;

/**
 * A number a renter typed, in E.164, or null.
 *
 * Vietnamese numbers as `toE164` reads them. Anything else must carry its
 * country code - `+44 7700 900123` or `0044 7700 900123` - because without
 * one, `7700900123` could be any country's. A `+84` number `toE164` refused is
 * a mistyped Vietnamese number, not a foreign one, so it stays refused.
 */
export function toRenterE164(raw: string): string | null {
  const vn = toE164(raw);
  if (vn) return vn;
  // `+44 (0)7700 900123` is how the UK writes it: the (0) is dialled at home only.
  let d = String(raw ?? '').replace(/\(0\)/g, '').replace(/[\s().\-/]/g, '');
  if (d.startsWith('00')) d = `+${d.slice(2)}`;
  if (!E164.test(d) || d.startsWith('+84')) return null;
  return d;
}

/**
 * Meta's `from` (the WhatsApp id) in E.164, or null.
 *
 * Meta sends full international digits without the plus. Vietnamese ids go
 * through `toE164` first so a Vietnamese renter's row is the same one their
 * typed number made.
 */
export function waIdToE164(raw: string): string | null {
  const vn = toE164(raw);
  if (vn) return vn;
  const d = `+${String(raw ?? '').replace(/\D/g, '')}`;
  return E164.test(d) ? d : null;
}

/**
 * E.164 country codes are prefix-free: 1 and 7 are one digit, these are two,
 * and every other code is three (ITU-T E.164 assignments).
 */
const TWO_DIGIT_COUNTRY_CODES = new Set([
  '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46', '47', '48', '49',
  '51', '52', '53', '54', '55', '56', '57', '58', '60', '61', '62', '63', '64', '65', '66',
  '81', '82', '84', '86', '90', '91', '92', '93', '94', '95', '98',
]);

/**
 * The number without its country code - `+447700900123` → `7700900123`,
 * `+84901234567` → `901234567`. What someone writes when they write the
 * number the way people at home do, and so what a leak check has to look for.
 * Mirrored by `public.renter_national_number()` for the ops thread mask.
 */
export function nationalNumber(e164: string): string | null {
  if (!E164.test(String(e164 ?? ''))) return null;
  const d = e164.slice(1);
  const ccLength = d[0] === '1' || d[0] === '7' ? 1 : TWO_DIGIT_COUNTRY_CODES.has(d.slice(0, 2)) ? 2 : 3;
  return d.slice(ccLength);
}

/**
 * Pull the messages out of a webhook payload.
 *
 * Meta nests them three deep and batches several changes per delivery, so a
 * payload can carry zero, one, or many. Status callbacks (delivered/read)
 * arrive on the same endpoint and carry no `messages` array - they are not
 * inbound messages and must not be treated as ones.
 */
// deno-lint-ignore no-explicit-any
export function parseInboundMessages(payload: any): InboundMessage[] {
  const out: InboundMessage[] = [];
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const m of change?.value?.messages ?? []) {
        // Non-text messages (images, audio, location) are acknowledged rather
        // than parsed: the window still re-opens, but there is no body.
        const text = m?.text?.body ?? '';
        // Any country: a renter on their home number is still a renter.
        const from = waIdToE164(m?.from ?? '');
        if (!from || !m?.id) continue;
        out.push({
          from,
          providerMessageId: String(m.id),
          text: String(text),
          timestamp: m?.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString(),
        });
      }
    }
  }
  return out;
}

/**
 * Meta's one-time subscription handshake: it GETs with a challenge and expects
 * the challenge echoed back verbatim as plain text.
 */
export function verifySubscription(
  url: URL,
  verifyToken: string,
): { ok: true; challenge: string } | { ok: false } {
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  if (mode === 'subscribe' && token && verifyToken && token === verifyToken && challenge) {
    return { ok: true, challenge };
  }
  return { ok: false };
}

/**
 * Opt-out keywords. Matched on the whole trimmed message, never a substring.
 *
 * **Diacritics are load-bearing here and must not be folded away.** `dừng` is
 * "stop"; `đúng` is "that's right". Strip the marks and both become `dung`,
 * at which point honouring an opt-out and opting out a renter who just agreed
 * are the same code path. This is why `classifyIntent` calls this function on
 * the raw text before it folds anything.
 */
const OPT_OUT = [
  'stop', 'unsubscribe',
  'huy', 'hủy', 'huỷ',
  'dung', 'dừng', 'dung lai', 'dừng lại',
  'khong nhan tin nua', 'không nhận tin nữa',
];

export function isOptOut(text: string): boolean {
  const t = text.trim().toLowerCase();
  // Substring matching would opt a renter out for saying "dung được" - fine,
  // that works - so the whole message has to be the keyword.
  return OPT_OUT.includes(t);
}
