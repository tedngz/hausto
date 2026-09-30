// The adapter's pure parts, kept apart from zca-js so they are tested without
// the library installed.

/** `+84901234567` to the local `0901234567`, the form Zalo's search takes. */
export function toLocalPhone(e164: string): string {
  return e164.startsWith('+84') ? `0${e164.slice(3)}` : e164;
}

/**
 * The image behind a photo message, for Hausto to copy (S7.2b). Zalo sends a
 * photo as an object: `href` the full image, `thumb` a small one, and
 * `params` a JSON string that may carry `hd`, the largest. Only a message
 * Zalo types as a photo - a shared link has an `href` too - and https only.
 */
export function photoUrlsOf(content: unknown, msgType: string | undefined): string[] {
  if (msgType !== 'chat.photo' || !content || typeof content !== 'object') return [];
  const c = content as Record<string, unknown>;
  let hd: unknown;
  if (typeof c.params === 'string') {
    try { hd = (JSON.parse(c.params) as Record<string, unknown>)?.hd; } catch { /* not JSON: no hd */ }
  }
  const url = [hd, c.href, c.thumb].find(u => typeof u === 'string' && u.startsWith('https://'));
  return url ? [url as string] : [];
}

/** Text out of a message's content, which is a string for plain text and an object otherwise. */
export function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object') {
    const c = content as Record<string, unknown>;
    for (const k of ['msg', 'text', 'title', 'description']) {
      if (typeof c[k] === 'string' && c[k]) return c[k] as string;
    }
  }
  return '';
}
