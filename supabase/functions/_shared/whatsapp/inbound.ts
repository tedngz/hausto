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

/** Normalize whatever Meta calls a phone number into E.164. */
export function toE164(raw: string): string | null {
  const d = String(raw ?? '').replace(/[^0-9+]/g, '');
  if (/^\+84[0-9]{9}$/.test(d)) return d;
  if (/^84[0-9]{9}$/.test(d)) return `+${d}`;
  if (/^0[0-9]{9}$/.test(d)) return `+84${d.slice(1)}`;
  return null;
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
        const from = toE164(m?.from ?? '');
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
