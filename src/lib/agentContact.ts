// The agent's number on a crawled listing, as `reveal_listing_contact` hands it
// to a signed-in renter (SPEC §6). Only the number printed on the original ad,
// never one an operator found - that rule lives in the SQL function, and this
// file only shapes what it returns for the listing page.

export type RevealRefusal = 'sign_in' | 'unknown_listing' | 'no_number' | 'daily_limit' | 'error';

export type RevealResult =
  | { ok: true; phoneE164: string; sourceUrl: string | null }
  | { ok: false; reason: RevealRefusal };

const REFUSALS: readonly RevealRefusal[] = ['sign_in', 'unknown_listing', 'no_number', 'daily_limit'];

/** Reads the function's jsonb answer. Anything unexpected is an error, never a number. */
export function parseReveal(data: unknown): RevealResult {
  if (!data || typeof data !== 'object') return { ok: false, reason: 'error' };
  const d = data as Record<string, unknown>;
  if (d.ok === true && typeof d.phone_e164 === 'string' && /^\+84\d{9,10}$/.test(d.phone_e164)) {
    return { ok: true, phoneE164: d.phone_e164, sourceUrl: safeHttpUrl(d.source_url) };
  }
  const reason = REFUSALS.find(r => r === d.reason);
  return { ok: false, reason: reason ?? 'error' };
}

/** A crawled link, only if it is a web address - never `javascript:` or the like. */
export function safeHttpUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

const VN_MOBILE = /^\+84([35789]\d)(\d{3})(\d{4})$/;
const VN_LANDLINE = /^\+84(2\d)(\d{4})(\d{4})$/;

/**
 * Written with the country code, so it dials from a foreign SIM as well as a
 * local one: "+84 90 123 4567", "+84 28 1234 5678".
 */
export function displayVnPhone(e164: string): string {
  const m = e164.match(VN_MOBILE) ?? e164.match(VN_LANDLINE);
  return m ? `+84 ${m[1]} ${m[2]} ${m[3]}` : e164;
}

/** Zalo opens a chat from a mobile number in its local form. Landlines have no Zalo. */
export function zaloLink(e164: string): string | null {
  return VN_MOBILE.test(e164) ? `https://zalo.me/0${e164.slice(3)}` : null;
}
