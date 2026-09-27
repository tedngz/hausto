// The adapter's pure parts, kept apart from zca-js so they are tested without
// the library installed.

/** `+84901234567` to the local `0901234567`, the form Zalo's search takes. */
export function toLocalPhone(e164: string): string {
  return e164.startsWith('+84') ? `0${e164.slice(3)}` : e164;
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
